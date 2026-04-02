import { Injectable, NotFoundException } from '@nestjs/common';
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

  async setConnectGroups(id: string, groupNames: string[]) {
    await this.ensureConnect(id);
    return this.prisma.connect.update({
      where: { id },
      data: { groupNames: Array.from(new Set(groupNames.map((n) => n.trim()).filter(Boolean))) },
    });
  }

  async getPublicFeedByCode(code: string): Promise<{
    encoded: string;
    /** Для HTTP-заголовка profile-title: настройка группы или имя пользователя панели */
    profileTitle: string;
  }> {
    const user = await this.prisma.panelUser.findUnique({
      where: { code },
    });

    if (!user || !user.enabled) {
      throw new NotFoundException('Пользователь не найден');
    }

    const groupMeta = await this.findGroupSubscriptionSettings(user.groupName);
    const groupTitle = groupMeta?.subscriptionDisplayName?.trim() ?? '';
    const profileTitle = (groupTitle || user.name.trim() || '').trim();

    const connects = await this.prisma.connect.findMany({
      where: {
        status: 'ACTIVE',
        groupNames: {
          has: user.groupName,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: { raw: true, name: true },
    });

    const payload = connects
      .map((c) =>
        this.applyCustomNameToUri(c.raw, groupTitle || c.name),
      )
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

    const groupMeta = await this.findGroupSubscriptionSettings(user.groupName);

    return {
      ...user,
      subscriptionDisplayName:
        groupMeta?.subscriptionDisplayName?.trim() || null,
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
   * Ищем настройки группы по строке groupName у пользователя панели.
   * Сначала точное совпадение (после trim), затем сравнение с нормализацией Unicode (NFC),
   * чтобы учесть расхождения с записями в Group.name без поломки фильтра connect.groupNames.
   */
  private async findGroupSubscriptionSettings(
    panelGroupName: string,
  ): Promise<{ subscriptionDisplayName: string | null } | null> {
    const trimmed = panelGroupName.trim();
    if (!trimmed) {
      return null;
    }
    const normalizedTarget = trimmed.normalize('NFC');

    const exact = await this.prisma.group.findUnique({
      where: { name: trimmed },
      select: { subscriptionDisplayName: true },
    });
    if (exact) {
      return exact;
    }

    const groups = await this.prisma.group.findMany({
      select: { name: true, subscriptionDisplayName: true },
    });
    const loose = groups.find(
      (g) => g.name.trim().normalize('NFC') === normalizedTarget,
    );
    return loose
      ? { subscriptionDisplayName: loose.subscriptionDisplayName }
      : null;
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

