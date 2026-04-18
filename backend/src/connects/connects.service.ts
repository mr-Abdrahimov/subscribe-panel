import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConnectStatus, Prisma, SubscriptionFeedMode } from '@prisma/client';
import {
  ensureUngroupedConnectGroupExists,
  UNGROUPED_CONNECT_GROUP_NAME,
} from '../common/ungrouped-connect-group';
import { BalancersService } from '../balancers/balancers.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConnectsService {
  private legacyNormalized = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly balancersService: BalancersService,
  ) {}

  async findAll() {
    await this.normalizeLegacyConnects();

    return this.prisma.connect.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        subscription: {
          select: {
            id: true,
            title: true,
            feedMode: true,
          },
        },
      },
    });
  }

  async toggleStatus(id: string) {
    await this.normalizeLegacyConnects();

    const connect = await this.prisma.connect.findUnique({
      where: { id },
    });

    if (!connect) {
      throw new NotFoundException('Коннект не найден');
    }

    const nextStatus =
      connect.status === ConnectStatus.ACTIVE
        ? ConnectStatus.INACTIVE
        : ConnectStatus.ACTIVE;

    return this.prisma.connect.update({
      where: { id },
      data: {
        status: nextStatus,
      },
    });
  }

  async hide(id: string) {
    await this.normalizeLegacyConnects();
    const connect = await this.prisma.connect.findUnique({
      where: { id },
    });

    if (!connect) {
      throw new NotFoundException('Коннект не найден');
    }

    return this.prisma.connect.update({
      where: { id },
      data: {
        hidden: !connect.hidden,
      },
    });
  }

  async addTag(id: string, tag: string) {
    await this.normalizeLegacyConnects();

    const connect = await this.prisma.connect.findUnique({
      where: { id },
      select: { tags: true },
    });

    if (!connect) {
      throw new NotFoundException('Коннект не найден');
    }

    const normalized = tag.trim();
    if (!normalized) {
      return connect;
    }

    const nextTags = Array.from(new Set([...(connect.tags ?? []), normalized]));

    return this.prisma.connect.update({
      where: { id },
      data: {
        tags: nextTags,
      },
    });
  }

  async updateName(id: string, name: string) {
    await this.normalizeLegacyConnects();
    await this.ensureExists(id);

    return this.prisma.connect.update({
      where: { id },
      data: {
        name: name.trim(),
      },
    });
  }

  /**
   * Редактирование rawJson вручную — только для коннектов, пришедших из подписки в режиме JSON.
   */
  async updateRawJson(id: string, rawJson: unknown) {
    await this.normalizeLegacyConnects();

    const connect = await this.prisma.connect.findUnique({
      where: { id },
      select: {
        id: true,
        protocol: true,
        subscription: { select: { feedMode: true } },
      },
    });

    if (!connect) {
      throw new NotFoundException('Коннект не найден');
    }

    if (connect.protocol === 'balancer') {
      throw new BadRequestException(
        'Редактирование JSON недоступно для коннекта-балансировщика',
      );
    }

    if (
      !connect.subscription ||
      connect.subscription.feedMode !== SubscriptionFeedMode.JSON
    ) {
      throw new BadRequestException(
        'Редактирование JSON доступно только для коннектов из подписки в режиме JSON',
      );
    }

    const value = this.assertPrismaJsonInput(rawJson);

    return this.prisma.connect.update({
      where: { id },
      data: { rawJson: value },
      include: {
        subscription: {
          select: { id: true, title: true, feedMode: true },
        },
      },
    });
  }

  private assertPrismaJsonInput(raw: unknown): Prisma.InputJsonValue {
    if (raw === null || raw === undefined) {
      throw new BadRequestException('Укажите валидный JSON (объект или массив)');
    }
    const kind = typeof raw;
    if (kind !== 'object') {
      throw new BadRequestException('rawJson должен быть объектом или массивом JSON');
    }
    try {
      JSON.parse(JSON.stringify(raw));
    } catch {
      throw new BadRequestException('Не удалось сериализовать rawJson в JSON');
    }
    return raw as Prisma.InputJsonValue;
  }

  async remove(id: string) {
    await this.normalizeLegacyConnects();
    await this.ensureExists(id);

    // Удаляем коннект из пулов всех балансировщиков до физического удаления
    await this.balancersService.removeConnectFromAllBalancers(id);

    await this.prisma.connect.delete({
      where: { id },
    });
  }

  async reorder(ids: string[]) {
    await this.normalizeLegacyConnects();

    for (let index = 0; index < ids.length; index += 1) {
      await this.prisma.connect.updateMany({
        where: { id: ids[index] },
        data: { sortOrder: index + 1 },
      });
    }

    return { success: true };
  }

  private async ensureExists(id: string) {
    const connect = await this.prisma.connect.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!connect) {
      throw new NotFoundException('Коннект не найден');
    }
  }

  private async normalizeLegacyConnects() {
    if (this.legacyNormalized) {
      return;
    }

    await ensureUngroupedConnectGroupExists(this.prisma);

    // Backfill old Connect documents that were created before
    // protocol/status/hidden/tags fields were introduced.
    await this.prisma.$runCommandRaw({
      update: 'Connect',
      updates: [
        {
          q: {
            $or: [{ protocol: null }, { protocol: { $exists: false } }],
          },
          u: { $set: { protocol: 'unknown' } },
          multi: true,
        },
        {
          q: {
            $or: [{ status: null }, { status: { $exists: false } }],
          },
          u: { $set: { status: 'ACTIVE' } },
          multi: true,
        },
        {
          q: {
            $or: [{ hidden: null }, { hidden: { $exists: false } }],
          },
          u: { $set: { hidden: false } },
          multi: true,
        },
        {
          q: {
            $or: [{ tags: null }, { tags: { $exists: false } }],
          },
          u: { $set: { tags: [] } },
          multi: true,
        },
        {
          q: {
            $or: [{ originalName: null }, { originalName: { $exists: false } }],
          },
          u: [
            {
              $set: {
                originalName: {
                  $ifNull: ['$name', 'Без названия'],
                },
              },
            },
          ],
          multi: true,
        },
        {
          q: {
            $or: [{ sortOrder: null }, { sortOrder: { $exists: false } }],
          },
          u: { $set: { sortOrder: 0 } },
          multi: true,
        },
        {
          q: {
            $or: [
              { groupNames: null },
              { groupNames: { $exists: false } },
              { groupNames: [] },
            ],
          },
          u: { $set: { groupNames: [UNGROUPED_CONNECT_GROUP_NAME] } },
          multi: true,
        },
      ],
    });

    this.legacyNormalized = true;
  }
}
