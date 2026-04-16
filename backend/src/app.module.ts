import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConnectsModule } from './connects/connects.module';
import { PrismaModule } from './prisma/prisma.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ManagementModule } from './management/management.module';
import { TelegramModule } from './telegram/telegram.module';
import { RedisModule } from './redis/redis.module';
import { SubscriptionAccessNotifyModule } from './subscription-access-notify/subscription-access-notify.module';
import { SubscriptionFetchModule } from './subscription-fetch/subscription-fetch.module';
import { BalancersModule } from './balancers/balancers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST')?.trim() ?? '127.0.0.1',
          port: Number(config.get<string>('REDIS_PORT') ?? 6379),
          password: (() => {
            const p = config.get<string>('REDIS_PASSWORD');
            return p === '' || p === undefined ? undefined : p;
          })(),
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    SubscriptionsModule,
    SubscriptionFetchModule,
    SubscriptionAccessNotifyModule,
    ConnectsModule,
    TelegramModule,
    ManagementModule,
    BalancersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
