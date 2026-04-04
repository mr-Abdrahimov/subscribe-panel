/** Данные для Telegram при первом успешном доступе с новым HWID */
export type SubscriptionAccessNotifyJobPayload = {
  panelUserName: string;
  panelUserCode: string;
  clientIp: string | null;
  userAgent: string | null;
  hwid: string | null;
  referer: string | null;
  queryParamsJson: string | null;
  /** Всегда true (уведомление не ставится при success=false) */
  success: boolean;
  createdAtIso: string;
};
