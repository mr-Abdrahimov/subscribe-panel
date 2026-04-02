import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ManagementService {
  constructor(private readonly prisma: PrismaService) {}

  listGroups() {
    return this.prisma.group.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  createGroup(name: string) {
    return this.prisma.group.create({
      data: { name: name.trim() },
    });
  }

  async deleteGroup(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Группа не найдена');
    }

    await this.prisma.group.delete({ where: { id } });

    await this.prisma.panelUser.deleteMany({
      where: { groupName: group.name },
    });

    await this.prisma.$runCommandRaw({
      update: 'Connect',
      updates: [
        {
          q: {},
          u: { $pull: { groupNames: group.name } },
          multi: true,
        },
      ],
    });
  }

  listUsers() {
    return this.prisma.panelUser.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  createUser(name: string, code: string, groupName: string) {
    return this.prisma.panelUser.create({
      data: {
        name: name.trim(),
        code: code.trim(),
        groupName: groupName.trim(),
      },
    });
  }

  async deleteUser(id: string) {
    await this.ensureUser(id);
    await this.prisma.panelUser.delete({ where: { id } });
  }

  async toggleUser(id: string) {
    const user = await this.ensureUser(id);
    return this.prisma.panelUser.update({
      where: { id },
      data: { enabled: !user.enabled },
    });
  }

  async updatePanelUser(
    id: string,
    dto: { name?: string; groupName?: string },
  ) {
    await this.ensureUser(id);
    const data: { name?: string; groupName?: string } = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Имя не может быть пустым');
      }
      data.name = trimmed;
    }
    if (dto.groupName !== undefined) {
      const trimmed = dto.groupName.trim();
      if (!trimmed) {
        throw new BadRequestException('Группа не может быть пустой');
      }
      const group = await this.prisma.group.findUnique({
        where: { name: trimmed },
      });
      if (!group) {
        throw new BadRequestException('Группа с таким названием не найдена');
      }
      data.groupName = trimmed;
    }
    if (Object.keys(data).length === 0) {
      return this.prisma.panelUser.findUnique({ where: { id } });
    }
    return this.prisma.panelUser.update({
      where: { id },
      data,
    });
  }

  async setConnectGroups(id: string, groupNames: string[]) {
    await this.ensureConnect(id);
    return this.prisma.connect.update({
      where: { id },
      data: { groupNames: Array.from(new Set(groupNames.map((n) => n.trim()).filter(Boolean))) },
    });
  }

  async getPublicFeedByCode(code: string): Promise<{
    encoded: string;
    /** HTTP profile-title: «Название для публичной подписки» из настроек группы, иначе имя пользователя панели */
    profileTitle: string;
  }> {
    const user = await this.prisma.panelUser.findUnique({
      where: { code },
    });

    if (!user || !user.enabled) {
      throw new NotFoundException('Пользователь не найден');
    }

    const connects = await this.prisma.connect.findMany({
      where: {
        status: 'ACTIVE',
        groupNames: {
          has: user.groupName,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: { raw: true, name: true, groupNames: true },
    });

    const allGroups = await this.prisma.group.findMany({
      select: { name: true, subscriptionDisplayName: true },
    });
    const candidates = this.buildSubscriptionProfileGroupCandidates(
      user.groupName,
      connects,
    );
    const groupTitle =
      this.resolveSubscriptionDisplayNameFromCandidates(
        candidates,
        allGroups,
      ) ?? '';
    const profileTitle = (groupTitle || user.name.trim() || '').trim();

    /** Фрагмент # в каждой строке — всегда кастомное имя коннекта (Connect.name). Заголовок profile-title — из настроек группы (сначала группа пользователя, затем группы коннектов ленты) или имени пользователя панели */
    const payload = connects
      .map((c) => this.applyCustomNameToUri(c.raw, c.name))
      .join('\n');
    return {
      encoded: Buffer.from(payload, 'utf-8').toString('base64'),
      profileTitle,
    };
  }

  async getPublicUserByCode(code: string) {
    const user = await this.prisma.panelUser.findUnique({
      where: { code },
      select: { name: true, code: true, enabled: true, groupName: true },
    });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const connects = await this.prisma.connect.findMany({
      where: {
        status: 'ACTIVE',
        groupNames: { has: user.groupName },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: { groupNames: true },
    });
    const allGroups = await this.prisma.group.findMany({
      select: { name: true, subscriptionDisplayName: true },
    });
    const candidates = this.buildSubscriptionProfileGroupCandidates(
      user.groupName,
      connects,
    );
    const sub =
      this.resolveSubscriptionDisplayNameFromCandidates(
        candidates,
        allGroups,
      ) ?? '';
    const profileTitle = (sub || user.name.trim() || '').trim() || null;

    return {
      ...user,
      subscriptionDisplayName: sub || null,
      /** Как в заголовке profile-title ленты */
      profileTitle,
    };
  }

  async updateGroupSettings(
    id: string,
    dto: { subscriptionDisplayName?: string | null },
  ) {
    await this.ensureGroupById(id);
    if (dto.subscriptionDisplayName === undefined) {
      return this.prisma.group.findUnique({ where: { id } });
    }
    let subscriptionDisplayName: string | null;
    if (dto.subscriptionDisplayName === null) {
      subscriptionDisplayName = null;
    } else {
      const trimmed = dto.subscriptionDisplayName.trim();
      subscriptionDisplayName = trimmed === '' ? null : trimmed;
    }
    return this.prisma.group.update({
      where: { id },
      data: { subscriptionDisplayName },
    });
  }

  private async ensureUser(id: string) {
    const user = await this.prisma.panelUser.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    return user;
  }

  private async ensureConnect(id: string) {
    const connect = await this.prisma.connect.findUnique({ where: { id } });
    if (!connect) {
      throw new NotFoundException('Коннект не найден');
    }
  }

  private async ensureGroupById(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Группа не найдена');
    }
    return group;
  }

  /**
   * Порядок имён групп для выбора subscriptionDisplayName: сначала группа пользователя панели,
   * затем остальные группы из коннектов ленты (в порядке коннектов и поля groupNames).
   */
  private buildSubscriptionProfileGroupCandidates(
    userGroupName: string,
    connects: { groupNames: string[] }[],
  ): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (name: string) => {
      const t = name.trim();
      if (!t || seen.has(t)) {
        return;
      }
      seen.add(t);
      out.push(t);
    };
    push(userGroupName);
    for (const c of connects) {
      for (const g of c.groupNames) {
        push(g);
      }
    }
    return out;
  }

  /**
   * Первое непустое subscriptionDisplayName среди кандидатов (совпадение имени группы:
   * trim → точное → NFC → без учёта регистра), как при привязке PanelUser к Group.
   */
  private resolveSubscriptionDisplayNameFromCandidates(
    candidates: string[],
    groups: { name: string; subscriptionDisplayName: string | null }[],
  ): string | null {
    for (const raw of candidates) {
      const trimmed = raw.trim();
      if (!trimmed) {
        continue;
      }
      const normalizedTarget = trimmed.normalize('NFC');
      const targetLower = normalizedTarget.toLowerCase();
      const row =
        groups.find((g) => g.name.trim() === trimmed) ??
        groups.find(
          (g) => g.name.trim().normalize('NFC') === normalizedTarget,
        ) ??
        groups.find(
          (g) =>
            g.name.trim().normalize('NFC').toLowerCase() === targetLower,
        );
      const sub = row?.subscriptionDisplayName?.trim();
      if (sub) {
        return sub;
      }
    }
    return null;
  }

  /**
   * Клиенты VPN (vless/vmess и др.) берут отображаемое имя из фрагмента URI после `#`.
   * Подставляем кастомное название из панели, не меняя саму ссылку.
   */
  private applyCustomNameToUri(raw: string, displayName: string): string {
    const label = displayName.trim();
    if (!label || !raw.trim()) {
      return raw;
    }
    const hash = raw.indexOf('#');
    const base = hash >= 0 ? raw.slice(0, hash) : raw;
    return `${base}#${encodeURIComponent(label)}`;
  }
}

