import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { buildMongoDatabaseUrl } from '../config/mongo-database-url';

const MONGO_ENV_KEYS = [
  'MONGO_HOST',
  'MONGO_PORT',
  'MONGO_DATABASE',
  'MONGO_REPLICA_SET',
  'MONGO_USERNAME',
  'MONGO_PASSWORD',
  'DATABASE_URL',
] as const;

function mergeMongoEnv(
  config: ConfigService,
): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  for (const k of MONGO_ENV_KEYS) {
    const v = config.get<string>(k);
    if (typeof v === 'string') {
      env[k] = v;
    }
  }
  return env;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      datasources: {
        db: {
          url: buildMongoDatabaseUrl(mergeMongoEnv(config)),
        },
      },
    });
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
