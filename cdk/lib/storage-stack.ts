import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class StorageStack extends cdk.Stack {
  public readonly modelBucket: s3.Bucket;
  public readonly gamesTable: dynamodb.Table;
  public readonly predictionsTable: dynamodb.Table;
  public readonly profileTable: dynamodb.Table;
  public readonly rawgKeyParam: ssm.IStringParameter;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // S3: Model artifacts
    this.modelBucket = new s3.Bucket(this, 'ModelBucket', {
      bucketName: `cartridge-model-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
    });

    // DynamoDB: Game library
    this.gamesTable = new dynamodb.Table(this, 'GamesTable', {
      tableName: 'cartridge-games',
      partitionKey: { name: 'game_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB: Predictions cache
    this.predictionsTable = new dynamodb.Table(this, 'PredictionsTable', {
      tableName: 'cartridge-predictions',
      partitionKey: { name: 'game_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // DynamoDB: Taste profile
    this.profileTable = new dynamodb.Table(this, 'ProfileTable', {
      tableName: 'cartridge-profile',
      partitionKey: { name: 'profile_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // SSM: Reference the RAWG key by name — the workflow sets the real value via put-parameter
    this.rawgKeyParam = ssm.StringParameter.fromStringParameterName(
      this, 'RawgApiKey', '/cartridge/rawg-api-key',
    );

    new cdk.CfnOutput(this, 'ModelBucketName', { value: this.modelBucket.bucketName });
    new cdk.CfnOutput(this, 'RawgParamName', { value: this.rawgKeyParam.parameterName });
  }
}
