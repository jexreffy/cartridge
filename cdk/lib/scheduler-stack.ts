import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

interface SchedulerStackProps extends cdk.StackProps {
  feedFunction: lambda.Function;
}

export class SchedulerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props);

    const rule = new events.Rule(this, 'WeeklyFeedRule', {
      ruleName: 'cartridge-weekly-feed',
      description: 'Refresh Cartridge new release feed every Sunday at midnight UTC',
      schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '0', minute: '0' }),
    });

    rule.addTarget(new targets.LambdaFunction(props.feedFunction, {
      event: events.RuleTargetInput.fromObject({ source: 'eventbridge', trigger: 'weekly' }),
    }));
  }
}
