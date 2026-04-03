#!/usr/bin/env node
/**
 * Печатает DATABASE_URL для Prisma CLI из того же набора переменных, что и Nest (см. mongo-database-url.ts).
 * Использование: node scripts/print-mongo-database-url.mjs [путь-к-.env]
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const envFile = process.argv[2] ?? resolve(root, `.env.${process.env.NODE_ENV ?? 'development'}`);

config({ path: envFile });

function build() {
  const host = process.env.MONGO_HOST?.trim();
  if (host) {
    const port = (process.env.MONGO_PORT ?? '27017').trim();
    const database = (process.env.MONGO_DATABASE ?? 'subscribe_panel').trim();
    const rs = (process.env.MONGO_REPLICA_SET ?? 'rs0').trim();
    const user = process.env.MONGO_USERNAME?.trim();
    const pass = process.env.MONGO_PASSWORD;
    let auth = '';
    if (user) {
      const p = pass !== undefined ? String(pass) : '';
      auth = `${encodeURIComponent(user)}:${encodeURIComponent(p)}@`;
    }
    const qs = rs ? `?replicaSet=${encodeURIComponent(rs)}` : '';
    return `mongodb://${auth}${host}:${port}/${encodeURIComponent(database)}${qs}`;
  }
  const fallback = process.env.DATABASE_URL?.trim();
  if (fallback) {
    return fallback;
  }
  console.error(
    'Ошибка: задайте MONGO_HOST или DATABASE_URL в',
    envFile,
  );
  process.exit(1);
}

process.stdout.write(build());
