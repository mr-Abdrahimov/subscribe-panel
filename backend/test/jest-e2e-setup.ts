import { config } from 'dotenv';
import { resolve } from 'node:path';

/** Jest выставляет NODE_ENV=test, поэтому Nest грузит .env.test; для e2e подмешиваем .env.development */
config({
  path: resolve(__dirname, '../.env.development'),
  quiet: true,
  override: true,
});

if (!process.env.MONGO_HOST?.trim() && !process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL =
    'mongodb://127.0.0.1:27017/subscribe_panel_e2e?replicaSet=rs0';
}
