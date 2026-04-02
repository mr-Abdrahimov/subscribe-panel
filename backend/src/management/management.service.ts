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

  async getPublicFeedByCode(code: string) {
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
      select: { raw: true, name: true },
    });

    const payload = connects
      .map((c) => this.applyCustomNameToUri(c.raw, c.name))
      .join('\n');
    return Buffer.from(payload, 'utf-8').toString('base64');
  }

  async getPublicUserByCode(code: string) {
    const user = await this.prisma.panelUser.findUnique({
      where: { code },
      select: { name: true, code: true, enabled: true, groupName: true },
    });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    return user;
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

