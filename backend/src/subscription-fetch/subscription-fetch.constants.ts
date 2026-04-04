export const SUBSCRIPTION_FETCH_QUEUE = 'subscription-fetch';

/** Сколько последних завершённых задач хранить в Redis (раздел Completed в Bull Board) */
export const SUBSCRIPTION_FETCH_COMPLETED_KEEP = 100;

/** Имя повторяющейся задачи: раз в минуту проверяет, какие подписки пора обновить */
export const SUBSCRIPTION_FETCH_SCHEDULER_JOB = 'scheduler-tick';

/** Задача: вызвать ту же логику, что и POST …/subscriptions/:id/fetch */
export const SUBSCRIPTION_FETCH_CONNECTS_JOB = 'fetch-connects';
