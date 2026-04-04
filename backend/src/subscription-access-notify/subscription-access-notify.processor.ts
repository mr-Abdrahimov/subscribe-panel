import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  SUBSCRIPTION_ACCESS_NOTIFY_JOB,
  SUBSCRIPTION_ACCESS_NOTIFY_QUEUE,
} from './subscription-access-notify.constants';
import type { SubscriptionAccessNotifyJobPayload } from './subscription-access-notify.types';

const PANEL_GLOBAL_SETTINGS_ID = 'global';

const TG_MESSAGE_MAX = 3800;

function escapeTelegramHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

@Processor(SUBSCRIPTION_ACCESS_NOTIFY_QUEUE, { concurrency: 3 })
export class SubscriptionAccessNotifyProcessor extends WorkerHost {
  private readonly log = new Logger(SubscriptionAccessNotifyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
  ) {
    super();
  }

  async process(job: Job<SubscriptionAccessNotifyJobPayload>): Promise<void> {
    if (job.name !== SUBSCRIPTION_ACCESS_NOTIFY_JOB) {
      this.log.warn(`Неизвестный тип задачи: ${job.name}`);
      return;
    }
    const row = await this.prisma.panelGlobalSettings.findUnique({
      where: { id: PANEL_GLOBAL_SETTINGS_ID },
      select: { telegramBotSecret: true, telegramGroupId: true },
    });
    const token = row?.telegramBotSecret?.trim() ?? '';
    const chatId = row?.telegramGroupId?.trim() ?? '';
    if (!token || !chatId) {
      return;
    }

    const p = job.data;
    const nameBold = escapeTelegramHtml(p.panelUserName);
    const hwidDisplay = p.hwid?.trim() ? escapeTelegramHtml(p.hwid) : '—';
    const lines = [
      '📡 Новый HWID (первое успешное получение ленты)',
      `Пользователь: <b>${nameBold}</b>`,
      `IP: https://ipinfo.io/${p.clientIp ?? '—'}`,
      // `User-Agent: ${p.userAgent ?? '—'}`,
      `HWID: <b>${hwidDisplay}</b>`,
      // `Referer: ${p.referer ?? '—'}`,
    ];
    // if (p.queryParamsJson) {
    //   lines.push(`Query: ${p.queryParamsJson}`);
    // }
    // lines.push(`Время: ${p.createdAtIso}`);

    let text = lines.join('\n');
    if (text.length > TG_MESSAGE_MAX) {
      text = `${text.slice(0, TG_MESSAGE_MAX - 1)}…`;
    }

    const r = await this.telegramService.sendMessage(token, chatId, text, {
      disableNotification: true,
      parseMode: 'HTML',
    });
    if (!r.ok) {
      this.log.warn(`Telegram (subscription access): ${r.error}`);
    }
  }
}
