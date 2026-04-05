import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  SUBSCRIPTION_FETCH_CONNECTS_JOB,
  SUBSCRIPTION_FETCH_QUEUE,
  SUBSCRIPTION_FETCH_SCHEDULER_JOB,
} from './subscription-fetch.constants';

@Processor(SUBSCRIPTION_FETCH_QUEUE, { concurrency: 4 })
export class SubscriptionFetchProcessor extends WorkerHost {
  private readonly log = new Logger(SubscriptionFetchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    @InjectQueue(SUBSCRIPTION_FETCH_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ subscriptionId?: string }>): Promise<void> {
    if (job.name === SUBSCRIPTION_FETCH_SCHEDULER_JOB) {
      await this.enqueueDueSubscriptions();
      return;
    }
    if (job.name === SUBSCRIPTION_FETCH_CONNECTS_JOB) {
      const id = job.data?.subscriptionId;
      if (!id) {
        this.log.warn('fetch-connects без subscriptionId');
        return;
      }
      try {
        await this.subscriptionsService.fetchConnects(id);
      } catch (e) {
        this.log.error(
          `Ошибка автообновления подписки ${id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        throw e;
      }
      return;
    }
    this.log.warn(`Неизвестный тип задачи: ${job.name}`);
  }

  private async enqueueDueSubscriptions() {
    const subs = await this.prisma.subscription.findMany({
      where: {
        fetchIntervalMinutes: { not: null, gt: 0 },
      },
      select: {
        id: true,
        lastFetchedAt: true,
        fetchIntervalMinutes: true,
      },
    });

    const now = Date.now();

    for (const sub of subs) {
      const minutes = sub.fetchIntervalMinutes;
      if (minutes == null || minutes <= 0) {
        continue;
      }
      const intervalMs = minutes * 60_000;
      const last = sub.lastFetchedAt?.getTime() ?? 0;
      if (now - last < intervalMs) {
        continue;
      }

      try {
        /**
         * Не задаём jobId: при removeOnFail в Redis остаются failed-задачи с тем же id,
         * и BullMQ отказывает в add — раньше ошибка глоталась, автообновление «залипало» навсегда.
         */
        await this.queue.add(
          SUBSCRIPTION_FETCH_CONNECTS_JOB,
          { subscriptionId: sub.id },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 45_000 },
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(
          `Не удалось поставить fetch-connects в очередь (подписка ${sub.id}): ${msg}`,
        );
      }
    }
  }
}
