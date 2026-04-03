import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizedConnectIdentity } from './connect-identity.util';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.subscription.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { connects: true },
        },
      },
    });
  }

  create(dto: CreateSubscriptionDto) {
    return this.prisma.subscription.create({
      data: {
        title: dto.title,
        url: dto.url,
      },
    });
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    await this.ensureExists(id);

    return this.prisma.subscription.update({
      where: { id },
      data: {
        title: dto.title,
        url: dto.url,
      },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);

    await this.prisma.connect.deleteMany({
      where: { subscriptionId: id },
    });

    await this.prisma.subscription.delete({
      where: { id },
    });
  }

  async fetchConnects(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException('Подписка не найдена');
    }

    const response = await fetch(subscription.url);
    const text = await response.text();
    const links = this.parseSubscriptionPayload(text);
    const existingConnects = await this.prisma.connect.findMany({
      where: { subscriptionId: id },
      select: {
        id: true,
        raw: true,
        name: true,
        originalName: true,
        sortOrder: true,
        protocol: true,
      },
    });

    /** Последняя строка в подписке для каждого нормализованного ключа (одинаковые по сути URI не дублируем). */
    const incomingByIdentity = new Map<
      string,
      {
        raw: string;
        originalName: string;
        protocol: string;
      }
    >();
    for (const raw of links) {
      const identity = normalizedConnectIdentity(raw);
      incomingByIdentity.set(identity, {
        raw,
        originalName: this.extractConnectName(raw),
        protocol: this.extractProtocol(raw),
      });
    }

    const incomingIdentities = new Set(incomingByIdentity.keys());

    const existingByIdentity = new Map<
      string,
      (typeof existingConnects)[number][]
    >();
    for (const c of existingConnects) {
      const identity = normalizedConnectIdentity(c.raw);
      const arr = existingByIdentity.get(identity);
      if (arr) {
        arr.push(c);
      } else {
        existingByIdentity.set(identity, [c]);
      }
    }

    const toDeleteIds: string[] = [];
    for (const [identityKey, group] of existingByIdentity) {
      const sorted = [...group].sort((a, b) => a.sortOrder - b.sortOrder);
      if (!incomingIdentities.has(identityKey)) {
        toDeleteIds.push(...sorted.map((c) => c.id));
        continue;
      }
      for (let i = 1; i < sorted.length; i += 1) {
        toDeleteIds.push(sorted[i]!.id);
      }
    }

    if (toDeleteIds.length > 0) {
      await this.prisma.connect.deleteMany({
        where: {
          id: {
            in: toDeleteIds,
          },
        },
      });
    }

    /** После удаления устаревших и дублей по identity. */
    const remainingConnects = await this.prisma.connect.findMany({
      where: { subscriptionId: id },
      select: {
        id: true,
        raw: true,
        originalName: true,
        sortOrder: true,
        protocol: true,
      },
    });
    const existingOneByIdentity = new Map<
      string,
      (typeof remainingConnects)[number]
    >();
    const remainingSorted = [...remainingConnects].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    for (const c of remainingSorted) {
      const identity = normalizedConnectIdentity(c.raw);
      if (!existingOneByIdentity.has(identity)) {
        existingOneByIdentity.set(identity, c);
      }
    }

    /**
     * Порядок на /connects — глобальный по sortOrder (все подписки в одной таблице).
     * Брать max только по текущей подписке давало дубликаты sortOrder с другими подписками;
     * при равном sortOrder сортировка идёт по createdAt desc — новый коннект оказывался не в конце.
     */
    const globalMaxAgg = await this.prisma.connect.aggregate({
      _max: { sortOrder: true },
    });
    let nextSortOrder = globalMaxAgg._max.sortOrder ?? 0;

    for (const [identity, incoming] of incomingByIdentity) {
      const existing = existingOneByIdentity.get(identity);
      if (!existing) {
        nextSortOrder += 1;

        await this.prisma.connect.create({
          data: {
            originalName: incoming.originalName,
            name: incoming.originalName,
            raw: incoming.raw,
            protocol: incoming.protocol,
            status: 'ACTIVE',
            hidden: false,
            tags: [],
            sortOrder: nextSortOrder,
            subscriptionId: id,
          },
        });
        continue;
      }

      const data: {
        raw?: string;
        originalName?: string;
        protocol?: string;
      } = {};
      if (existing.raw !== incoming.raw) {
        data.raw = incoming.raw;
      }
      if (existing.originalName !== incoming.originalName) {
        data.originalName = incoming.originalName;
      }
      if (existing.protocol !== incoming.protocol) {
        data.protocol = incoming.protocol;
      }
      if (Object.keys(data).length > 0) {
        await this.prisma.connect.update({
          where: { id: existing.id },
          data,
        });
      }
    }

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id },
      data: { lastFetchedAt: new Date() },
    });

    const connects = await this.prisma.connect.findMany({
      where: { subscriptionId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    });

    return {
      subscriptionId: id,
      fetchedAt: updatedSubscription.lastFetchedAt,
      total: connects.length,
      connects,
    };
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Подписка не найдена');
    }
  }

  private parseSubscriptionPayload(payload: string) {
    const trimmed = payload.trim();
    let content = trimmed;

    const looksLikeBase64 =
      !trimmed.includes('://') && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);

    if (looksLikeBase64) {
      try {
        content = Buffer.from(trimmed.replace(/\s/g, ''), 'base64').toString(
          'utf-8',
        );
      } catch {
        content = trimmed;
      }
    }

    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => /^[a-z][a-z0-9+.-]*:\/\//i.test(line));
  }

  private extractConnectName(raw: string) {
    try {
      const hash = raw.split('#')[1];
      if (hash) {
        const decoded = decodeURIComponent(hash).trim();
        if (decoded.length > 0) {
          return decoded;
        }
      }

      const url = new URL(raw);
      return url.hostname || 'Без названия';
    } catch {
      return 'Без названия';
    }
  }

  private extractProtocol(raw: string) {
    const scheme = raw.split('://')[0]?.trim().toLowerCase();
    return scheme || 'unknown';
  }
}
