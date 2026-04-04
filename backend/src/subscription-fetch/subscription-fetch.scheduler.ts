import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  SUBSCRIPTION_FETCH_QUEUE,
  SUBSCRIPTION_FETCH_SCHEDULER_JOB,
} from './subscription-fetch.constants';

/**
 * Регистрирует повторяющуюся задачу «тик» раз в минуту (см. Bull Board).
 * По тику воркер подставляет в очередь fetch-connects для просроченных подписок.
 */
@Injectable()
export class SubscriptionFetchScheduler implements OnApplicationBootstrap {
  private readonly log = new Logger(SubscriptionFetchScheduler.name);

  constructor(
    @InjectQueue(SUBSCRIPTION_FETCH_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') {
      this.log.warn('Планировщик BullMQ пропущен (NODE_ENV=test)');
      return;
    }
    try {
      const repeatables = await this.queue.getRepeatableJobs();
      for (const r of repeatables) {
        if (r.name === SUBSCRIPTION_FETCH_SCHEDULER_JOB) {
          await this.queue.removeRepeatableByKey(r.key);
        }
      }

      await this.queue.add(
        SUBSCRIPTION_FETCH_SCHEDULER_JOB,
        {},
        {
          repeat: { every: 60_000 },
        },
      );
      this.log.log(
        'Планировщик подписок: повтор каждые 60 с (очередь subscription-fetch)',
      );
    } catch (e) {
      this.log.error(
        `Не удалось зарегистрировать планировщик BullMQ: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }
}
