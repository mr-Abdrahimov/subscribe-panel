import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import {
  SUBSCRIPTION_ACCESS_NOTIFY_COMPLETED_KEEP,
  SUBSCRIPTION_ACCESS_NOTIFY_QUEUE,
} from './subscription-access-notify.constants';
import { SubscriptionAccessNotifyProcessor } from './subscription-access-notify.processor';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: SUBSCRIPTION_ACCESS_NOTIFY_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { count: SUBSCRIPTION_ACCESS_NOTIFY_COMPLETED_KEEP },
        removeOnFail: { count: 50 },
      },
    }),
  ],
  providers: [SubscriptionAccessNotifyProcessor],
  exports: [BullModule],
})
export class SubscriptionAccessNotifyModule {}
