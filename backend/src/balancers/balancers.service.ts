import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBalancerDto } from './dto/create-balancer.dto';
import type { UpdateBalancerDto } from './dto/update-balancer.dto';
import { UNGROUPED_CONNECT_GROUP_NAME } from '../common/ungrouped-connect-group';

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
        rawJson: rawJson as unknown as Parameters<typeof this.prisma.connect.create>[0]['data']['rawJson'],
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
    const newConnectIds = dto.connectIds ?? existing.connectIds;

    if (newConnectIds.length === 0) {
      throw new BadRequestException('Необходимо выбрать хотя бы один коннект');
    }

    const existingConnects = await this.prisma.connect.findMany({
      where: { id: { in: newConnectIds } },
      select: { id: true, name: true, raw: true, rawJson: true },
    });

    if (existingConnects.length !== newConnectIds.length) {
      throw new BadRequestException('Некоторые коннекты не найдены');
    }

    for (const c of existingConnects) {
      if (c.raw.startsWith(BALANCER_CONNECT_RAW_PREFIX)) {
        throw new BadRequestException(
          `Коннект «${c.name}» является балансировщиком и не может входить в пул`,
        );
      }
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
        rawJson: rawJson as unknown as Parameters<typeof this.prisma.connect.updateMany>[0]['data']['rawJson'],
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
   * Строит JSON-объект selector outbound для JSON-ленты пользователя.
   * Формат совместим с v2ray/Xray selector, который выбирает самый быстрый сервер.
   */
  private buildSelectorOutbound(
    name: string,
    connects: Array<{ id: string; name: string; raw: string; rawJson: unknown }>,
  ): Record<string, unknown> {
    const selectors = connects.map((c) => c.name);

    return {
      remarks: name,
      dns: { servers: ['1.1.1.1', '1.0.0.1'], queryStrategy: 'UseIP' },
      routing: {
        rules: [{ type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' }],
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
        {
          tag: 'proxy',
          protocol: 'selector',
          settings: {
            selectors,
            strategy: 'leastping',
          },
        },
        { tag: 'direct', protocol: 'freedom' },
        { tag: 'block', protocol: 'blackhole' },
      ],
      balancerConnectIds: connects.map((c) => c.id),
    };
  }
}
