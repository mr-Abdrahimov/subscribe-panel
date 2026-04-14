import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { deduplicateUngroupedConnectGroup } from '../common/ungrouped-connect-group';

async function withMongoWriteRetry<T>(
  logger: Logger,
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2034'
      ) {
        const delayMs = 40 * 2 ** i;
        logger.warn(
          `Конфликт записи MongoDB (P2034), повтор ${i + 1}/${attempts} через ${delayMs} мс`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    const name = this.config.get<string>('ADMIN_NAME') ?? 'Admin';

    if (!email || !password) {
      this.logger.warn(
        'ADMIN_EMAIL or ADMIN_PASSWORD is not set. Admin user seed skipped.',
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await withMongoWriteRetry(this.logger, () =>
      this.prisma.user.upsert({
        where: { email },
        create: {
          email,
          name,
          password: passwordHash,
          role: Role.ADMIN,
        },
        update: {
          name,
          password: passwordHash,
          role: Role.ADMIN,
        },
      }),
    );

    this.logger.log(`Admin user ensured: ${email}`);

    await deduplicateUngroupedConnectGroup(this.prisma);
  }
}
