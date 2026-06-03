#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkingStack } from '../lib/networking-stack';
import { StorageStack } from '../lib/storage-stack';
import { ImportStack } from '../lib/import-stack';
import { ApiStack } from '../lib/api-stack';
import { SchedulerStack } from '../lib/scheduler-stack';
import { CdnStack } from '../lib/cdn-stack';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };

const networking = new NetworkingStack(app, 'CartridgeNetworking', { env });

const storage = new StorageStack(app, 'CartridgeStorage', {
  env,
  vpc: networking.vpc,
});

const importStack = new ImportStack(app, 'CartridgeImport', {
  env,
  vpc: networking.vpc,
  lambdaSg: networking.lambdaSg,
  modelBucket: storage.modelBucket,
  gamesTable: storage.gamesTable,
  profileTable: storage.profileTable,
});

const api = new ApiStack(app, 'CartridgeApi', {
  env,
  vpc: networking.vpc,
  lambdaSg: networking.lambdaSg,
  gamesTable: storage.gamesTable,
  predictionsTable: storage.predictionsTable,
  profileTable: storage.profileTable,
  modelBucket: storage.modelBucket,
  trainFunction: importStack.trainFunction,
});

new SchedulerStack(app, 'CartridgeScheduler', {
  env,
  feedFunction: api.feedFunction,
});

new CdnStack(app, 'CartridgeCdn', {
  env,
  apiUrl: api.apiUrl,
});
