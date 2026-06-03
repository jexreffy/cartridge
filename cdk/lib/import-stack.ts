import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { RAWG_PARAM_NAME } from './storage-stack';

interface ImportStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  modelBucket: s3.Bucket;
  gamesTable: dynamodb.Table;
  profileTable: dynamodb.Table;
}

export class ImportStack extends cdk.Stack {
  public readonly trainFunction: lambda.Function;
  public readonly csvBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ImportStackProps) {
    super(scope, id, props);

    const { vpc, lambdaSg, modelBucket, gamesTable, profileTable } = props;

    // CSV bucket lives here to avoid cross-stack S3 notification circular dependency
    this.csvBucket = new s3.Bucket(this, 'CsvBucket', {
      bucketName: `cartridge-csv-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    const RUNTIME = lambda.Runtime.PYTHON_3_12;
    const apiCode = lambda.Code.fromAsset('../api');

    // Train Lambda — no VPC needed (reads DynamoDB, writes S3, calls Bedrock)
    this.trainFunction = new lambda.Function(this, 'TrainFunction', {
      functionName: 'cartridge-train',
      runtime: RUNTIME,
      handler: 'train/handler.handler',
      code: apiCode,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(10),
      logGroup: new logs.LogGroup(this, 'TrainLogGroup', {
        logGroupName: '/aws/lambda/cartridge-train',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        GAMES_TABLE: gamesTable.tableName,
        PROFILE_TABLE: profileTable.tableName,
        MODEL_BUCKET: modelBucket.bucketName,
      },
    });

    gamesTable.grantReadData(this.trainFunction);
    profileTable.grantWriteData(this.trainFunction);
    modelBucket.grantReadWrite(this.trainFunction);
    this.trainFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // Import Lambda — outside VPC to reach RAWG (public internet)
    const importFunction = new lambda.Function(this, 'ImportFunction', {
      functionName: 'cartridge-import',
      runtime: RUNTIME,
      handler: 'import/handler.handler',
      code: apiCode,
      memorySize: 512,
      timeout: cdk.Duration.minutes(15),
      logGroup: new logs.LogGroup(this, 'ImportLogGroup', {
        logGroupName: '/aws/lambda/cartridge-import',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        GAMES_TABLE: gamesTable.tableName,
        TRAIN_FUNCTION: this.trainFunction.functionName,
        RAWG_API_KEY_PARAM: RAWG_PARAM_NAME,
      },
    });

    this.csvBucket.grantRead(importFunction);
    gamesTable.grantWriteData(importFunction);
    this.trainFunction.grantInvoke(importFunction);

    // Grant SSM read access by ARN (avoids CloudFormation SecureString resolution issue)
    importFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${RAWG_PARAM_NAME}`],
    }));

    // Trigger import when CSV lands in bucket
    this.csvBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(importFunction),
      { suffix: '.csv' },
    );

    new cdk.CfnOutput(this, 'CsvUploadBucket', { value: this.csvBucket.bucketName });
  }
}
