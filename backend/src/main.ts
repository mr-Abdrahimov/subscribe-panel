import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getQueueToken } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type {
  Application,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import type { Queue } from 'bullmq';
import { AppModule } from './app.module';
import { SUBSCRIPTION_FETCH_QUEUE } from './subscription-fetch/subscription-fetch.constants';

const BULL_BOARD_COOKIE = 'sp_bull_board_token';

function readBullBoardTokenFromCookie(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) {
    return undefined;
  }
  const prefix = `${BULL_BOARD_COOKIE}=`;
  for (const part of raw.split(';')) {
    const s = part.trim();
    if (s.startsWith(prefix)) {
      try {
        return decodeURIComponent(s.slice(prefix.length));
      } catch {
        return s.slice(prefix.length);
      }
    }
  }
  return undefined;
}

function isBullBoardAuthOk(
  req: Request,
  res: Response,
  expected: string,
  cookiePath: string,
): boolean {
  const q = req.query['token'];
  const qs = typeof q === 'string' ? q : '';
  const h = req.headers['x-bull-board-token'];
  const ht = typeof h === 'string' ? h : Array.isArray(h) ? h[0] : '';
  const fromCookie = readBullBoardTokenFromCookie(req);

  if (qs === expected || ht === expected || fromCookie === expected) {
    if (qs === expected || ht === expected) {
      const v = encodeURIComponent(expected);
      res.append(
        'Set-Cookie',
        `${BULL_BOARD_COOKIE}=${v}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
      );
    }
    return true;
  }
  return false;
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const http = app.getHttpAdapter().getInstance() as Application;
  http.set('trust proxy', true);

  app.enableCors({
    origin: config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3001',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle(config.get<string>('SWAGGER_TITLE') ?? 'API')
    .setDescription(config.get<string>('SWAGGER_DESCRIPTION') ?? '')
    .setVersion(config.get<string>('SWAGGER_VERSION') ?? '1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  const swaggerPath = config.get<string>('SWAGGER_PATH') ?? 'docs';
  SwaggerModule.setup(swaggerPath, app, document);

  const bullBoardEnabled =
    config.get<string>('BULL_BOARD_ENABLED')?.toLowerCase() === 'true';

  if (bullBoardEnabled) {
    try {
      /**
       * Путь на процессе Nest (после nginx `location /api/ { proxy_pass .../; }` это без префикса /api).
       */
      const bullBoardMountPath =
        config.get<string>('BULL_BOARD_MOUNT_PATH')?.trim() || '/admin/queues';
      /**
       * Путь в браузере (ссылки и статика Bull Board). Если API снаружи — `/api/...`, задайте
       * BULL_BOARD_PUBLIC_PATH=/api/admin/queues, иначе UI грузит `/admin/queues/static/...` с корня домена.
       */
      const bullBoardPublicPath =
        config.get<string>('BULL_BOARD_PUBLIC_PATH')?.trim() || bullBoardMountPath;

      const serverAdapter = new ExpressAdapter();
      serverAdapter.setBasePath(bullBoardPublicPath);
      const queue = app.get<Queue>(getQueueToken(SUBSCRIPTION_FETCH_QUEUE));
      createBullBoard({
        queues: [new BullMQAdapter(queue)],
        serverAdapter,
      });
      const token = config.get<string>('BULL_BOARD_TOKEN')?.trim();
      if (token) {
        http.use(
          bullBoardMountPath,
          (req: Request, res: Response, next: NextFunction) => {
            if (isBullBoardAuthOk(req, res, token, bullBoardPublicPath)) {
              return next();
            }
            res.status(403).send('Forbidden');
          },
        );
      }
      http.use(bullBoardMountPath, serverAdapter.getRouter() as RequestHandler);
      logger.log(
        `Bull Board: смонтирован на ${bullBoardMountPath}, публичный basePath=${bullBoardPublicPath}`,
      );
    } catch (e) {
      logger.error(
        `Bull Board не смонтирован: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  await app.listen(config.get<number>('PORT') ?? 3000);
  const appUrl = (await app.getUrl()).replace('[::1]', 'localhost');

  console.log(`🚀 Сервер запущен     ${appUrl}`);
  console.log(`📚 Swagger UI:        ${appUrl}/${swaggerPath}`);
  if (bullBoardEnabled) {
    const mount =
      config.get<string>('BULL_BOARD_MOUNT_PATH')?.trim() || '/admin/queues';
    const pub =
      config.get<string>('BULL_BOARD_PUBLIC_PATH')?.trim() || mount;
    const externalBase =
      config.get<string>('FRONTEND_ORIGIN')?.replace(/\/$/, '') ||
      new URL(appUrl).origin;
    console.log(`📊 Bull Board (процесс): ${appUrl}${mount}/`);
    if (pub !== mount) {
      console.log(`📊 Bull Board (браузер):  ${externalBase}${pub}/`);
    }
    if (config.get<string>('BULL_BOARD_TOKEN')?.trim()) {
      console.log(
        `   Доступ: ?token=… (cookie Path=${pub}) или заголовок x-bull-board-token`,
      );
    }
  }
}
void bootstrap();
