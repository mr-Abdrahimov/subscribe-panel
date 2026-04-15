import { log } from "node:console";

/**
 * Строка подключения Prisma к MongoDB из MONGO_HOST / MONGO_PORT / MONGO_DATABASE.
 * Если MONGO_HOST не задан — используется DATABASE_URL (обратная совместимость).
 */
export function buildMongoDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const host = env.MONGO_HOST?.trim();
  if (host) {
    const port = (env.MONGO_PORT ?? '27017').trim();
    const database = (env.MONGO_DATABASE ?? 'subscribe_panel').trim();
    const rs = (env.MONGO_REPLICA_SET ?? 'rs0').trim();
    const user = env.MONGO_USERNAME?.trim();
    const pass = env.MONGO_PASSWORD;
    let auth = '';
    if (user) {
      const p = pass !== undefined ? String(pass) : '';
      auth = `${encodeURIComponent(user)}:${encodeURIComponent(p)}@`;
    }
    const qs = rs ? `?replicaSet=${encodeURIComponent(rs)}` : '';
    return `mongodb://${auth}${host}:${port}/${encodeURIComponent(database)}${qs}`;
  }
  console.log(11111)
  const fallback = env.DATABASE_URL?.trim();
  if (fallback) {
    console.log(fallback)
    return fallback;
  }
  throw new Error(
    'Задайте MONGO_HOST (и при необходимости MONGO_PORT, MONGO_DATABASE, MONGO_REPLICA_SET) или DATABASE_URL',
  );
}
