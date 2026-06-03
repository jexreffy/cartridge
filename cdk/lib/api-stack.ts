import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { RAWG_PARAM_NAME, TABLE_NAMES, MODEL_BUCKET_NAME } from './storage-stack';

interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  csvBucket: s3.Bucket;
  trainFunction: lambda.Function;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly feedFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { vpc, lambdaSg, csvBucket, trainFunction, userPool, userPoolClient } = props;

    // Reference tables and bucket by name — no CloudFormation cross-stack export dependency
    const gamesTable = dynamodb.Table.fromTableName(this, 'GamesTable', TABLE_NAMES.GAMES);
    const predictionsTable = dynamodb.Table.fromTableName(this, 'PredictionsTable', TABLE_NAMES.PREDICTIONS);
    const profileTable = dynamodb.Table.fromTableName(this, 'ProfileTable', TABLE_NAMES.PROFILE);
    const modelBucket = s3.Bucket.fromBucketName(this, 'ModelBucket', MODEL_BUCKET_NAME(this.account));

    const RUNTIME = lambda.Runtime.PYTHON_3_12;
    const apiCode = lambda.Code.fromAsset('../api', {
      bundling: {
        image: RUNTIME.bundlingImage,
        command: [
          'bash', '-c',
          'pip install -r requirements.txt -t /asset-output --no-compile && cp -r . /asset-output',
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
        GAMES_TABLE: TABLE_NAMES.GAMES,
        PROFILE_TABLE: TABLE_NAMES.PROFILE,
      },
    });
    gamesTable.grantReadData(readFunction);
    profileTable.grantReadData(readFunction);

    // Games Lambda — write operations: add, edit, delete, import trigger, retrain
    const gamesFunction = new lambda.Function(this, 'GamesFunction', {
      functionName: 'cartridge-games',
      runtime: RUNTIME,
      handler: 'games/handler.handler',
      code: apiCode,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'GamesLogGroup', {
        logGroupName: '/aws/lambda/cartridge-games',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        GAMES_TABLE: TABLE_NAMES.GAMES,
        CSV_BUCKET: csvBucket.bucketName,
        TRAIN_FUNCTION: trainFunction.functionName,
        RAWG_API_KEY_PARAM: RAWG_PARAM_NAME,
      },
    });
    gamesTable.grantReadWriteData(gamesFunction);
    csvBucket.grantWrite(gamesFunction);
    trainFunction.grantInvoke(gamesFunction);
    gamesFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [ssmParamArn],
    }));

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
        PREDICTIONS_TABLE: TABLE_NAMES.PREDICTIONS,
        PROFILE_TABLE: TABLE_NAMES.PROFILE,
        MODEL_BUCKET: MODEL_BUCKET_NAME(this.account),
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
        PREDICTIONS_TABLE: TABLE_NAMES.PREDICTIONS,
        PROFILE_TABLE: TABLE_NAMES.PROFILE,
        PREDICT_FUNCTION: predictFunction.functionName,
        RAWG_API_KEY_PARAM: RAWG_PARAM_NAME,
      },
    });
    predictionsTable.grantReadWriteData(this.feedFunction);
    profileTable.grantReadData(this.feedFunction);
    predictFunction.grantInvoke(this.feedFunction);
    this.feedFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [ssmParamArn],
    }));

    // Cognito JWT authorizer
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      userPool.userPoolProviderUrl,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

    // API Gateway
    const api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'cartridge-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const readInt   = new integrations.HttpLambdaIntegration('ReadInt',   readFunction);
    const gamesInt  = new integrations.HttpLambdaIntegration('GamesInt',  gamesFunction);
    const predictInt = new integrations.HttpLambdaIntegration('PredictInt', predictFunction);
    const feedInt   = new integrations.HttpLambdaIntegration('FeedInt',   this.feedFunction);

    api.addRoutes({ path: '/library',          methods: [apigw.HttpMethod.GET],                             integration: readInt,    authorizer: jwtAuthorizer });
    api.addRoutes({ path: '/profile',          methods: [apigw.HttpMethod.GET],                             integration: readInt,    authorizer: jwtAuthorizer });
    api.addRoutes({ path: '/import',           methods: [apigw.HttpMethod.POST],                            integration: gamesInt,   authorizer: jwtAuthorizer });
    api.addRoutes({ path: '/games',            methods: [apigw.HttpMethod.POST],                            integration: gamesInt,   authorizer: jwtAuthorizer });
    api.addRoutes({ path: '/games/{game_id}',  methods: [apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE],    integration: gamesInt,   authorizer: jwtAuthorizer });
    api.addRoutes({ path: '/train',            methods: [apigw.HttpMethod.POST],                            integration: gamesInt,   authorizer: jwtAuthorizer });
    api.addRoutes({ path: '/predict',          methods: [apigw.HttpMethod.GET],                             integration: predictInt, authorizer: jwtAuthorizer });
    api.addRoutes({ path: '/feed',             methods: [apigw.HttpMethod.GET],                             integration: feedInt,    authorizer: jwtAuthorizer });

    this.apiUrl = api.apiEndpoint;

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint, exportName: 'CartridgeApiUrl' });
  }
}
