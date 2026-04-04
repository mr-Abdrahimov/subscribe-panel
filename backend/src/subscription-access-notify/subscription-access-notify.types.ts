/** Полезная нагрузка задачи — те же поля, что попадают в лог GET /public/sub */
export type SubscriptionAccessNotifyJobPayload = {
  panelUserName: string;
  panelUserCode: string;
  clientIp: string | null;
  userAgent: string | null;
  hwid: string | null;
  referer: string | null;
  queryParamsJson: string | null;
  success: boolean;
  createdAtIso: string;
};
