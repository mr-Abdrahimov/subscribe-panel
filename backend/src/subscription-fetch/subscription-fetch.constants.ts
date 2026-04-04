export const SUBSCRIPTION_FETCH_QUEUE = 'subscription-fetch';

/** Имя повторяющейся задачи: раз в минуту проверяет, какие подписки пора обновить */
export const SUBSCRIPTION_FETCH_SCHEDULER_JOB = 'scheduler-tick';

/** Задача: вызвать ту же логику, что и POST …/subscriptions/:id/fetch */
export const SUBSCRIPTION_FETCH_CONNECTS_JOB = 'fetch-connects';
