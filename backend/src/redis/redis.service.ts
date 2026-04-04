import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('REDIS_HOST')?.trim() ?? '127.0.0.1';
    const port = Number(this.config.get<string>('REDIS_PORT') ?? 6379);
    const password = this.config.get<string>('REDIS_PASSWORD');
    this.client = new Redis({
      host,
      port,
      password:
        password === '' || password === undefined ? undefined : password,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      this.logger.warn('Redis: подключение пропущено (NODE_ENV=test)');
      return;
    }
    try {
      await this.client.connect();
      await this.client.ping();
      this.logger.log(
        `Redis: подключено к ${this.client.options.host}:${this.client.options.port}`,
      );
    } catch (e) {
      this.logger.error(
        `Redis: не удалось подключиться (${this.client.options.host}:${this.client.options.port}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
