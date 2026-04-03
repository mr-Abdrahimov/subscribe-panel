import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

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

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      await this.prisma.user.update({
        where: { email },
        data: {
          name,
          password: passwordHash,
          role: Role.ADMIN,
        },
      });
    } else {
      await this.prisma.user.create({
        data: {
          email,
          name,
          password: passwordHash,
          role: Role.ADMIN,
        },
      });
    }

    this.logger.log(`Admin user ensured: ${email}`);
  }
}
