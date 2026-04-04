import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SUBSCRIPTION_ACCESS_NOTIFY_QUEUE } from '../subscription-access-notify/subscription-access-notify.constants';
import { ManagementController } from './management.controller';
import { ManagementService } from './management.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SUBSCRIPTION_ACCESS_NOTIFY_QUEUE,
    }),
  ],
  controllers: [ManagementController],
  providers: [ManagementService],
})
export class ManagementModule {}
