import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBalancerDto } from './dto/create-balancer.dto';
import type { UpdateBalancerDto } from './dto/update-balancer.dto';
import { UNGROUPED_CONNECT_GROUP_NAME } from '../common/ungrouped-connect-group';
import { uriToOutbound, extractProxyOutbound } from '../subscriptions/uri-to-outbound.util';

/** Префикс raw для коннекта-балансировщика — используется для идентификации */
const BALANCER_CONNECT_RAW_PREFIX = 'balancer://';

@Injectable()
export class BalancersService {
  private readonly logger = new Logger(BalancersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.balancer.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        connects: {
          where: { balancerId: { not: null } },
          select: { id: true, name: true },
          take: 1,
        },
      },
    });
  }

  async findOne(id: string) {
    const balancer = await this.prisma.balancer.findUnique({
      where: { id },
      include: {
        connects: {
          where: { balancerId: { not: null } },
          select: { id: true, name: true },
          take: 1,
        },
      },
    });
    if (!balancer) throw new NotFoundException(`Балансировщик ${id} не найден`);
    return balancer;
  }

  async create(dto: CreateBalancerDto) {
    if (dto.connectIds.length === 0) {
      throw new BadRequestException('Необходимо выбрать хотя бы один коннект');
    }

    const existingConnects = await this.prisma.connect.findMany({
      where: { id: { in: dto.connectIds } },
      select: { id: true, name: true, raw: true, rawJson: true },
    });

    if (existingConnects.length !== dto.connectIds.length) {
      throw new BadRequestException('Некоторые коннекты не найдены');
    }

    // Не допускаем выбор коннектов-балансировщиков в пул
    for (const c of existingConnects) {
      if (c.raw.startsWith(BALANCER_CONNECT_RAW_PREFIX)) {
        throw new BadRequestException(
          `Коннект «${c.name}» является балансировщиком и не может входить в пул другого балансировщика`,
        );
      }
    }

    const balancer = await this.prisma.balancer.create({
      data: {
        name: dto.name,
        connectIds: dto.connectIds,
      },
    });

    const rawJson = this.buildSelectorOutbound(dto.name, existingConnects);

    await this.prisma.connect.create({
      data: {
        name: dto.name,
        originalName: dto.name,
        groupNames: [UNGROUPED_CONNECT_GROUP_NAME],
        raw: `${BALANCER_CONNECT_RAW_PREFIX}${balancer.id}`,
        rawJson: rawJson as Prisma.InputJsonValue,
        protocol: 'balancer',
        status: 'ACTIVE',
        hidden: false,
        tags: [],
        sortOrder: 0,
        balancerId: balancer.id,
      },
    });

    this.logger.log(`Создан балансировщик «${dto.name}» (${balancer.id})`);
    return balancer;
  }

  async update(id: string, dto: UpdateBalancerDto) {
    const existing = await this.prisma.balancer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Балансировщик ${id} не найден`);

    const newName = dto.name ?? existing.name;
    const requestedConnectIds = dto.connectIds ?? existing.connectIds;

    // Загружаем только реально существующие коннекты (остальные молча игнорируем)
    const foundConnects = await this.prisma.connect.findMany({
      where: { id: { in: requestedConnectIds } },
      select: { id: true, name: true, raw: true, rawJson: true },
    });

    // Убираем коннекты-балансировщики из пула
    const existingConnects = foundConnects.filter(
      (c) => !c.raw.startsWith(BALANCER_CONNECT_RAW_PREFIX),
    );

    const newConnectIds = existingConnects.map((c) => c.id);

    if (newConnectIds.length === 0) {
      throw new BadRequestException('Необходимо выбрать хотя бы один коннект');
    }

    const balancer = await this.prisma.balancer.update({
      where: { id },
      data: { name: newName, connectIds: newConnectIds },
    });

    const rawJson = this.buildSelectorOutbound(newName, existingConnects);

    // Обновляем коннект-балансировщик
    await this.prisma.connect.updateMany({
      where: { balancerId: id },
      data: {
        name: newName,
        originalName: newName,
        rawJson: rawJson as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Обновлён балансировщик «${newName}» (${id})`);
    return balancer;
  }

  async remove(id: string) {
    const existing = await this.prisma.balancer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Балансировщик ${id} не найден`);

    // Коннект-балансировщик удаляется каскадно через onDelete: Cascade
    await this.prisma.balancer.delete({ where: { id } });
    this.logger.log(`Удалён балансировщик «${existing.name}» (${id})`);
  }

  /**
   * Удаляет коннект из пула всех балансировщиков, которые на него ссылаются.
   * Вызывается автоматически при удалении коннекта.
   * Если после удаления пул балансировщика становится пустым — балансировщик тоже удаляется.
   */
  async removeConnectFromAllBalancers(connectId: string): Promise<void> {
    // Находим все балансировщики, у которых в connectIds есть этот ID
    const affected = await this.prisma.balancer.findMany({
      where: { connectIds: { has: connectId } },
      include: {
        connects: {
          where: { balancerId: { not: null } },
          select: { id: true },
        },
      },
    });

    if (affected.length === 0) return;

    for (const balancer of affected) {
      const newConnectIds = balancer.connectIds.filter((cid) => cid !== connectId);

      if (newConnectIds.length === 0) {
        // Пул пуст — удаляем сам балансировщик (коннект удалится каскадно)
        await this.prisma.balancer.delete({ where: { id: balancer.id } });
        this.logger.log(
          `Балансировщик «${balancer.name}» (${balancer.id}) удалён, т.к. все коннекты из его пула были удалены`,
        );
        continue;
      }

      // Обновляем список ID
      await this.prisma.balancer.update({
        where: { id: balancer.id },
        data: { connectIds: newConnectIds },
      });

      // Перестраиваем rawJson балансировщика без удалённого коннекта
      const poolConnects = await this.prisma.connect.findMany({
        where: { id: { in: newConnectIds } },
        select: { id: true, name: true, raw: true, rawJson: true },
      });

      const rawJson = this.buildSelectorOutbound(balancer.name, poolConnects);

      await this.prisma.connect.updateMany({
        where: { balancerId: balancer.id },
        data: { rawJson: rawJson as Prisma.InputJsonValue },
      });

      this.logger.log(
        `Коннект ${connectId} удалён из пула балансировщика «${balancer.name}» (${balancer.id}), осталось коннектов: ${newConnectIds.length}`,
      );
    }
  }

  /**
   * Строит полный v2ray/Xray конфиг с балансировщиком leastLoad.
   * Каждый коннект из пула — отдельный outbound (proxy, proxy-2, proxy-3...).
   * routing.balancers выбирает самый быстрый через burstObservatory.
   */
  private buildSelectorOutbound(
    name: string,
    connects: Array<{ id: string; name: string; raw: string; rawJson: unknown }>,
  ): Record<string, unknown> {
    // Строим outbound-объект для каждого коннекта пула
    const proxyOutbounds: Record<string, unknown>[] = [];
    for (let i = 0; i < connects.length; i++) {
      const c = connects[i];
      const tag = i === 0 ? 'proxy' : `proxy-${i + 1}`;

      // Пытаемся получить outbound из rawJson или из URI
      let outbound: Record<string, unknown> | null = null;
      if (c.rawJson && typeof c.rawJson === 'object' && !Array.isArray(c.rawJson)) {
        outbound = extractProxyOutbound(c.rawJson as Record<string, unknown>);
      }
      if (!outbound && c.raw && !c.raw.startsWith('balancer://') && !c.raw.startsWith('json://')) {
        const parsed = uriToOutbound(c.raw);
        if (parsed) outbound = parsed as unknown as Record<string, unknown>;
      }

      if (outbound) {
        // Убираем tag из outbound (он может быть 'proxy'), заменяем на наш
        const { tag: _t, ...rest } = outbound as Record<string, unknown>;
        void _t;
        proxyOutbounds.push({ ...rest, tag });
      }
    }

    // Если не удалось сгенерировать ни одного outbound — пустой конфиг
    if (proxyOutbounds.length === 0) {
      this.logger.warn(`buildSelectorOutbound: no valid outbounds for balancer "${name}"`);
    }

    const proxyTags = proxyOutbounds.map((o) => o['tag'] as string);
    const balancerTag = 'Super_Balancer';

    return {
      remarks: name,
      dns: { servers: ['1.1.1.1', '1.0.0.1'], queryStrategy: 'UseIP' },
      routing: {
        rules: [
          { type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' },
          { type: 'field', network: 'tcp,udp', balancerTag },
        ],
        balancers: [
          {
            tag: balancerTag,
            selector: proxyTags,
            strategy: {
              type: 'leastLoad',
              settings: {
                maxRTT: '1s',
                expected: 2,
                baselines: ['1s'],
                tolerance: 0.01,
              },
            },
            fallbackTag: 'direct',
          },
        ],
        domainMatcher: 'hybrid',
        domainStrategy: 'IPIfNonMatch',
      },
      inbounds: [
        {
          tag: 'socks',
          port: 10808,
          listen: '127.0.0.1',
          protocol: 'socks',
          settings: { udp: true, auth: 'noauth' },
          sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
        },
        {
          tag: 'http',
          port: 10809,
          listen: '127.0.0.1',
          protocol: 'http',
          settings: { allowTransparent: false },
          sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
        },
      ],
      outbounds: [
        ...proxyOutbounds,
        { tag: 'direct', protocol: 'freedom' },
        { tag: 'block', protocol: 'blackhole' },
      ],
      burstObservatory: {
        pingConfig: {
          timeout: '2s',
          interval: '1m',
          sampling: 3,
          destination: 'http://www.gstatic.com/generate_204',
          // connectivity: '',
          enableConcurrency: true,
        },
        subjectSelector: proxyTags,
      },
      // Служебное поле — не отправляется в Happ, используется для обновления при редактировании
      balancerConnectIds: connects.map((c) => c.id),
    };
  }
}
