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

// Table names as constants — other stacks reference these via Table.fromTableName()
// to avoid CloudFormation cross-stack export/import coupling.
export const TABLE_NAMES = {
  GAMES: 'cartridge-games-v2',
  PREDICTIONS: 'cartridge-predictions-v2',
  PROFILE: 'cartridge-profile-v2',
} as const;

export const MODEL_BUCKET_NAME = (account: string) => `cartridge-model-${account}`;

export class StorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // S3: Model artifacts
    new s3.Bucket(this, 'ModelBucket', {
      bucketName: MODEL_BUCKET_NAME(this.account),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
    });

    // DynamoDB: Game library — PK=user_id, SK=game_id (multi-user ready)
    new dynamodb.Table(this, 'GamesTable', {
      tableName: TABLE_NAMES.GAMES,
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'game_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB: Predictions cache — PK=user_id, SK=game_id#pred#date
    new dynamodb.Table(this, 'PredictionsTable', {
      tableName: TABLE_NAMES.PREDICTIONS,
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // DynamoDB: Taste profile — PK=user_id
    new dynamodb.Table(this, 'ProfileTable', {
      tableName: TABLE_NAMES.PROFILE,
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
