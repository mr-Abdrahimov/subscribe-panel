import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { sliceProfileTitleForHappSubscription } from '../common/profile-title-header';

@Injectable()
export class ManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
    /** subscriptionDisplayName группы пользователя панели (PanelUser.groupName → Group); для HTTP profile-title имя пользователя не подставляем */
    profileTitle: string;
  }> {
    const user = await this.prisma.panelUser.findUnique({
      where: { code },
    });

    if (!user || !user.enabled) {
      throw new NotFoundException('Пользователь не найден');
    }

    const groupTitle =
      (await this.resolveSubscriptionDisplayNameForUserGroup(
        user.groupName,
      )) ?? '';
    const profileTitle = groupTitle.trim();

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

    /** Фрагмент # — Connect.name. В начале тела (после base64-декода) — #profile-title для Happ; заголовки — см. setProfileTitleResponseHeaders */
    const uriLines = connects.map((c) =>
      this.applyCustomNameToUri(c.raw, c.name),
    );
    const bodyText = profileTitle
      ? `#profile-title: ${sliceProfileTitleForHappSubscription(profileTitle)}\n${uriLines.join('\n')}`
      : uriLines.join('\n');
    return {
      encoded: Buffer.from(bodyText, 'utf-8').toString('base64'),
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

    const sub =
      (await this.resolveSubscriptionDisplayNameForUserGroup(
        user.groupName,
      )) ?? '';
    const trimmedSub = sub.trim();
    const profileTitle = trimmedSub || null;

    const appLinks = await this.getPublicAppLinksForCode(user.code);

    return {
      ...user,
      subscriptionDisplayName: trimmedSub || null,
      /** Как profile-title ленты: subscriptionDisplayName группы пользователя */
      profileTitle,
      /** Название и готовая ссылка для блока «Приложения» на /sub */
      appLinks,
    };
  }

  listSubscriptionAppLinks() {
    return this.prisma.subscriptionAppLink.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createSubscriptionAppLink(dto: {
    name: string;
    urlTemplate: string;
    sortOrder?: number;
  }) {
    const name = dto.name.trim();
    const urlTemplate = dto.urlTemplate.trim();
    if (!name) {
      throw new BadRequestException('Название не может быть пустым');
    }
    if (!urlTemplate) {
      throw new BadRequestException('Ссылка не может быть пустой');
    }
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const agg = await this.prisma.subscriptionAppLink.aggregate({
        _max: { sortOrder: true },
      });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }
    return this.prisma.subscriptionAppLink.create({
      data: { name, urlTemplate, sortOrder },
    });
  }

  async updateSubscriptionAppLink(
    id: string,
    dto: { name?: string; urlTemplate?: string; sortOrder?: number },
  ) {
    await this.ensureSubscriptionAppLink(id);
    const data: {
      name?: string;
      urlTemplate?: string;
      sortOrder?: number;
    } = {};
    if (dto.name !== undefined) {
      const n = dto.name.trim();
      if (!n) {
        throw new BadRequestException('Название не может быть пустым');
      }
      data.name = n;
    }
    if (dto.urlTemplate !== undefined) {
      const u = dto.urlTemplate.trim();
      if (!u) {
        throw new BadRequestException('Ссылка не может быть пустой');
      }
      data.urlTemplate = u;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (Object.keys(data).length === 0) {
      return this.prisma.subscriptionAppLink.findUnique({ where: { id } });
    }
    return this.prisma.subscriptionAppLink.update({
      where: { id },
      data,
    });
  }

  async deleteSubscriptionAppLink(id: string) {
    await this.ensureSubscriptionAppLink(id);
    await this.prisma.subscriptionAppLink.delete({ where: { id } });
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

  private async ensureSubscriptionAppLink(id: string) {
    const row = await this.prisma.subscriptionAppLink.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Запись не найдена');
    }
    return row;
  }

  /**
   * База для полного URL страницы подписки: сначала PUBLIC_SUBSCRIPTION_BASE_URL,
   * иначе FRONTEND_ORIGIN (чтобы всегда получать https://домен/sub/CODE при наличии env).
   */
  private subscriptionPublicOrigin(): string {
    const primary = (this.config.get<string>('PUBLIC_SUBSCRIPTION_BASE_URL') ?? '')
      .trim()
      .replace(/\/$/, '');
    if (primary) {
      return primary;
    }
    return (this.config.get<string>('FRONTEND_ORIGIN') ?? '')
      .trim()
      .replace(/\/$/, '');
  }

  /** Полный абсолютный URL: origin + /sub/{code} (code — подписка пользователя панели) */
  private buildSubscriptionPageUrl(code: string): string {
    const base = this.subscriptionPublicOrigin();
    const path = `/sub/${encodeURIComponent(code)}`;
    if (!base) {
      return path;
    }
    return `${base}${path}`;
  }

  private resolveAppLinkUrl(
    template: string,
    subscriptionPageUrl: string,
  ): string {
    return template.replaceAll('{link}', subscriptionPageUrl);
  }

  private async getPublicAppLinksForCode(
    code: string,
  ): Promise<{ name: string; url: string }[]> {
    const links = await this.prisma.subscriptionAppLink.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (links.length === 0) {
      return [];
    }
    const subscriptionPageUrl = this.buildSubscriptionPageUrl(code);
    return links.map((l) => ({
      name: l.name,
      url: this.resolveAppLinkUrl(l.urlTemplate, subscriptionPageUrl),
    }));
  }

  /**
   * Название подписки из админки для группы пользователя: PanelUser.groupName → Group.name,
   * поле subscriptionDisplayName. Точное имя, затем NFC и регистронезависимое совпадение с Group.name.
   */
  private async resolveSubscriptionDisplayNameForUserGroup(
    panelGroupName: string,
  ): Promise<string | null> {
    const trimmed = panelGroupName.trim();
    if (!trimmed) {
      return null;
    }

    const exact = await this.prisma.group.findUnique({
      where: { name: trimmed },
      select: { subscriptionDisplayName: true },
    });
    if (exact) {
      const t = exact.subscriptionDisplayName?.trim();
      return t || null;
    }

    const normalizedTarget = trimmed.normalize('NFC');
    const targetLower = normalizedTarget.toLowerCase();
    const groups = await this.prisma.group.findMany({
      select: { name: true, subscriptionDisplayName: true },
    });
    const row =
      groups.find(
        (g) => g.name.trim().normalize('NFC') === normalizedTarget,
      ) ??
      groups.find(
        (g) =>
          g.name.trim().normalize('NFC').toLowerCase() === targetLower,
      );
    const sub = row?.subscriptionDisplayName?.trim();
    return sub || null;
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

