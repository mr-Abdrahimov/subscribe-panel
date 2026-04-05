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
      /** Текст в MarkdownV2; спецсимволы должны быть экранированы на стороне вызывающего кода */
      markdownV2?: boolean;
    },
  ): Promise<TelegramSendResult> {
    const token = botToken.trim();
    const chat = chatId.trim();
    const body = text.trim();
    if (!token || !chat || !body) {
      return { ok: false, error: 'Пустой токен, chat id или текст' };
    }
    const maxAttempts = 3;
    let lastDesc = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const api = new Api(token);
        const msg = await api.sendMessage(chat, body, {
          link_preview_options: { is_disabled: true },
          ...(options?.markdownV2 === true
            ? { parse_mode: 'MarkdownV2' as const }
            : {}),
          ...(options?.disableNotification === true
            ? { disable_notification: true }
            : {}),
        });
        return { ok: true, messageId: msg.message_id };
      } catch (e: unknown) {
        lastDesc =
          e && typeof e === 'object' && 'description' in e
            ? String((e as { description?: unknown }).description)
            : e instanceof Error
              ? e.message
              : String(e);
        const retryable =
          attempt < maxAttempts &&
          /network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|timed out/i.test(
            lastDesc,
          );
        if (retryable) {
          const delayMs = 800 * attempt + Math.floor(Math.random() * 400);
          this.logger.warn(
            `Telegram sendMessage попытка ${attempt}/${maxAttempts} не удалась (${lastDesc}), повтор через ${delayMs} мс`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        this.logger.warn(`Telegram sendMessage failed: ${lastDesc}`);
        return { ok: false, error: lastDesc };
      }
    }
    return { ok: false, error: lastDesc || 'Неизвестная ошибка' };
  }
}
