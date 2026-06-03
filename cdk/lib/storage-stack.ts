import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

// The RAWG API key SSM parameter name — set by the deploy workflow via put-parameter
export const RAWG_PARAM_NAME = '/cartridge/rawg-api-key';

export class StorageStack extends cdk.Stack {
  public readonly modelBucket: s3.Bucket;
  public readonly gamesTable: dynamodb.Table;
  public readonly predictionsTable: dynamodb.Table;
  public readonly profileTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // S3: Model artifacts
    this.modelBucket = new s3.Bucket(this, 'ModelBucket', {
      bucketName: `cartridge-model-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
    });

    // DynamoDB: Game library — PK=user_id, SK=game_id (multi-user ready)
    this.gamesTable = new dynamodb.Table(this, 'GamesTable', {
      tableName: 'cartridge-games',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'game_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB: Predictions cache — PK=user_id, SK=game_id#pred#date
    this.predictionsTable = new dynamodb.Table(this, 'PredictionsTable', {
      tableName: 'cartridge-predictions',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // DynamoDB: Taste profile — PK=user_id
    this.profileTable = new dynamodb.Table(this, 'ProfileTable', {
      tableName: 'cartridge-profile',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, 'ModelBucketName', { value: this.modelBucket.bucketName });
  }
}
