import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ensureUngroupedConnectGroupExists,
  UNGROUPED_CONNECT_GROUP_NAME,
} from '../common/ungrouped-connect-group';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizedConnectIdentity,
  prepareConnectUriForParse,
  vlessCoreIdentityForMatching,
} from './connect-identity.util';
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
        fetchIntervalMinutes: dto.fetchIntervalMinutes ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    await this.ensureExists(id);

    const data: Prisma.SubscriptionUpdateInput = {
      title: dto.title,
      url: dto.url,
    };
    if (dto.fetchIntervalMinutes !== undefined) {
      data.fetchIntervalMinutes = dto.fetchIntervalMinutes;
    }

    return this.prisma.subscription.update({
      where: { id },
      data,
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

    await ensureUngroupedConnectGroupExists(this.prisma);

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
        identityKey: true,
        createdAt: true,
      },
    });

    /**
     * Одна запись на identity: дубликаты строк в подписке схлопываем (последняя строка побеждает).
     * Порядок строк в файле подписки не влияет на «удалить/создать»: только на то, какое raw оставить.
     */
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

    /**
     * Явное сопоставление: коннект из подписки ищем в БД по текущему normalize(raw) ИЛИ по сохранённому identityKey.
     * Раньше «лишние» определялись только по normalize(raw) — при расхождении с identityKey строка удалялась
     * и создавалась заново с новым sortOrder (визуально «в конец»).
     */
    const matchedIds = new Set<string>();
    const poolSorted = [...existingConnects].sort((a, b) => {
      const byOrder = a.sortOrder - b.sortOrder;
      if (byOrder !== 0) {
        return byOrder;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

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
      const existing = poolSorted.find(
        (c) =>
          !matchedIds.has(c.id) &&
          this.connectMatchesIdentity(c, identity, incoming.raw),
      );

      if (!existing) {
        nextSortOrder += 1;

        await this.prisma.connect.create({
          data: {
            originalName: incoming.originalName,
            name: incoming.originalName,
            raw: incoming.raw,
            identityKey: identity,
            protocol: incoming.protocol,
            status: 'ACTIVE',
            hidden: false,
            tags: [],
            groupNames: [UNGROUPED_CONNECT_GROUP_NAME],
            sortOrder: nextSortOrder,
            subscriptionId: id,
          },
        });
        continue;
      }

      matchedIds.add(existing.id);

      const data: {
        raw?: string;
        originalName?: string;
        protocol?: string;
        identityKey?: string;
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
      if ((existing.identityKey ?? '') !== identity) {
        data.identityKey = identity;
      }
      if (Object.keys(data).length > 0) {
        await this.prisma.connect.update({
          where: { id: existing.id },
          data,
        });
      }
    }

    const staleIds = existingConnects
      .filter((c) => !matchedIds.has(c.id))
      .map((c) => c.id);
    if (staleIds.length > 0) {
      await this.prisma.connect.deleteMany({
        where: { id: { in: staleIds } },
      });
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

  /**
   * Совпадение: полный ключ (normalize raw), сохранённый identityKey, либо ядро VLESS
   * (uuid+хост+порт+reality/tls без «шумовых» query) — чтобы не пересоздавать запись и не сбрасывать groupNames.
   */
  private connectMatchesIdentity(
    c: { raw: string; identityKey: string | null },
    incomingIdentity: string,
    incomingRaw: string,
  ): boolean {
    if (normalizedConnectIdentity(c.raw) === incomingIdentity) {
      return true;
    }
    const stored = c.identityKey?.trim();
    if (!!stored && stored === incomingIdentity) {
      return true;
    }
    const coreRow = vlessCoreIdentityForMatching(c.raw);
    const coreIn = vlessCoreIdentityForMatching(incomingRaw);
    return (
      coreRow !== null &&
      coreIn !== null &&
      coreRow.length > 0 &&
      coreRow === coreIn
    );
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
    const prepared = prepareConnectUriForParse(raw);
    try {
      const hash = prepared.split('#')[1];
      if (hash) {
        const decoded = decodeURIComponent(hash).trim();
        if (decoded.length > 0) {
          return decoded;
        }
      }

      const baseOnly = prepared.includes('#')
        ? prepared.slice(0, prepared.indexOf('#'))
        : prepared;
      const url = new URL(baseOnly);
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
