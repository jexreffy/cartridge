import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { RAWG_PARAM_NAME } from './storage-stack';

interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  gamesTable: dynamodb.Table;
  predictionsTable: dynamodb.Table;
  profileTable: dynamodb.Table;
  modelBucket: s3.Bucket;
  trainFunction: lambda.Function;
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly feedFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { vpc, lambdaSg, gamesTable, predictionsTable, profileTable, modelBucket, trainFunction } = props;
    const RUNTIME = lambda.Runtime.PYTHON_3_12;
    const apiCode = lambda.Code.fromAsset('../api', {
      bundling: {
        image: RUNTIME.bundlingImage,
        command: [
          'bash', '-c',
          'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output',
        ],
      },
    });

    const ssmParamArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${RAWG_PARAM_NAME}`;

    const sharedVpcProps = {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSg],
    };

    // Read Lambda — library + profile endpoints (VPC, DynamoDB only)
    const readFunction = new lambda.Function(this, 'ReadFunction', {
      functionName: 'cartridge-read',
      runtime: RUNTIME,
      handler: 'read/handler.handler',
      code: apiCode,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      ...sharedVpcProps,
      logGroup: new logs.LogGroup(this, 'ReadLogGroup', {
        logGroupName: '/aws/lambda/cartridge-read',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        GAMES_TABLE: gamesTable.tableName,
        PROFILE_TABLE: profileTable.tableName,
      },
    });
    gamesTable.grantReadData(readFunction);
    profileTable.grantReadData(readFunction);

    // Predict Lambda — outside VPC (needs RAWG public API)
    const predictFunction = new lambda.Function(this, 'PredictFunction', {
      functionName: 'cartridge-predict',
      runtime: RUNTIME,
      handler: 'predict/handler.handler',
      code: apiCode,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'PredictLogGroup', {
        logGroupName: '/aws/lambda/cartridge-predict',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        GAMES_TABLE: gamesTable.tableName,
        PREDICTIONS_TABLE: predictionsTable.tableName,
        PROFILE_TABLE: profileTable.tableName,
        MODEL_BUCKET: modelBucket.bucketName,
        RAWG_API_KEY_PARAM: RAWG_PARAM_NAME,
      },
    });
    predictionsTable.grantWriteData(predictFunction);
    profileTable.grantReadData(predictFunction);
    modelBucket.grantRead(predictFunction);
    predictFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [ssmParamArn],
    }));

    // Feed Lambda — outside VPC (needs RAWG + invokes Predict)
    this.feedFunction = new lambda.Function(this, 'FeedFunction', {
      functionName: 'cartridge-feed',
      runtime: RUNTIME,
      handler: 'feed/handler.handler',
      code: apiCode,
      memorySize: 256,
      timeout: cdk.Duration.minutes(5),
      logGroup: new logs.LogGroup(this, 'FeedLogGroup', {
        logGroupName: '/aws/lambda/cartridge-feed',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        PREDICTIONS_TABLE: predictionsTable.tableName,
        PREDICT_FUNCTION: predictFunction.functionName,
        RAWG_API_KEY_PARAM: RAWG_PARAM_NAME,
      },
    });
    predictionsTable.grantReadWriteData(this.feedFunction);
    predictFunction.grantInvoke(this.feedFunction);
    this.feedFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [ssmParamArn],
    }));

    // API Gateway
    const api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'cartridge-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET],
        allowHeaders: ['Content-Type'],
      },
    });

    const readInt = new integrations.HttpLambdaIntegration('ReadInt', readFunction);
    const predictInt = new integrations.HttpLambdaIntegration('PredictInt', predictFunction);
    const feedInt = new integrations.HttpLambdaIntegration('FeedInt', this.feedFunction);

    api.addRoutes({ path: '/library', methods: [apigw.HttpMethod.GET], integration: readInt });
    api.addRoutes({ path: '/profile', methods: [apigw.HttpMethod.GET], integration: readInt });
    api.addRoutes({ path: '/predict', methods: [apigw.HttpMethod.GET], integration: predictInt });
    api.addRoutes({ path: '/feed', methods: [apigw.HttpMethod.GET], integration: feedInt });

    this.apiUrl = api.apiEndpoint;

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint, exportName: 'CartridgeApiUrl' });
  }
}
