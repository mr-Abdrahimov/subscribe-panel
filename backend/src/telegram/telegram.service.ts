import { Injectable, Logger } from '@nestjs/common';
import { Api } from 'grammy';

export type TelegramSendResult =
  | { ok: true; messageId: number }
  | { ok: false; error: string };

/**
 * Отправка сообщений через Telegram Bot API (grammy {@link Api}).
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  /**
   * @param chatId — числовой id, либо строка вида "-100…" для супергрупп
   * @param options.disableNotification — бесшумное уведомление (без звука на устройстве)
   */
  async sendMessage(
    botToken: string,
    chatId: string,
    text: string,
    options?: {
      disableNotification?: boolean;
      /** Разметка Telegram Bot API */
      parseMode?: 'HTML' | 'MarkdownV2';
    },
  ): Promise<TelegramSendResult> {
    const token = botToken.trim();
    const chat = chatId.trim();
    const body = text.trim();
    if (!token || !chat || !body) {
      return { ok: false, error: 'Пустой токен, chat id или текст' };
    }
    try {
      const api = new Api(token);
      const msg = await api.sendMessage(chat, body, {
        link_preview_options: { is_disabled: true },
        ...(options?.parseMode === 'HTML'
          ? { parse_mode: 'HTML' as const }
          : options?.parseMode === 'MarkdownV2'
            ? { parse_mode: 'MarkdownV2' as const }
            : {}),
        ...(options?.disableNotification === true
          ? { disable_notification: true }
          : {}),
      });
      return { ok: true, messageId: msg.message_id };
    } catch (e: unknown) {
      const desc =
        e && typeof e === 'object' && 'description' in e
          ? String((e as { description?: unknown }).description)
          : e instanceof Error
            ? e.message
            : String(e);
      this.logger.warn(`Telegram sendMessage failed: ${desc}`);
      return { ok: false, error: desc };
    }
  }
}
