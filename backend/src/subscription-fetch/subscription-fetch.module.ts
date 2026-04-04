import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SUBSCRIPTION_FETCH_QUEUE } from './subscription-fetch.constants';
import { SubscriptionFetchProcessor } from './subscription-fetch.processor';
import { SubscriptionFetchScheduler } from './subscription-fetch.scheduler';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SUBSCRIPTION_FETCH_QUEUE,
    }),
    PrismaModule,
    SubscriptionsModule,
  ],
  providers: [SubscriptionFetchProcessor, SubscriptionFetchScheduler],
})
export class SubscriptionFetchModule {}
