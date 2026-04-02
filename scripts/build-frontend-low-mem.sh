#!/usr/bin/env bash
set -euo pipefail

# Сборка Nuxt на VPS с ~1 ГБ RAM: освобождаем память (Docker, PM2), иначе ядро
# убивает процесс (OOM) на этапе Vite «rendering chunks».

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_ENV="${1:-backend/.env.production}"

echo "==> Останавливаем PM2 (освобождаем RAM)"
pm2 stop all 2>/dev/null || true

echo "==> Останавливаем Docker Compose: ${COMPOSE_ENV}"
cd "${ROOT}"
docker compose --env-file "${COMPOSE_ENV}" down 2>/dev/null || docker compose down 2>/dev/null || true

echo "==> Сборка frontend"
cd "${ROOT}/frontend"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
export UV_THREADPOOL_SIZE=2
npm ci
npm run build

if [[ ! -f .output/server/index.mjs ]]; then
  echo "Ошибка: нет .output/server/index.mjs после сборки." >&2
  exit 1
fi

echo "==> Поднимаем Docker"
cd "${ROOT}"
docker compose --env-file "${COMPOSE_ENV}" up -d

echo "==> Запускаем PM2"
ECOSYSTEM="${ROOT}/ecosystem.config.cjs"
if pm2 describe subscribe-backend >/dev/null 2>&1; then
  pm2 reload "${ECOSYSTEM}" --update-env
else
  pm2 start "${ECOSYSTEM}"
fi

echo "Готово. Проверка: test -f ${ROOT}/frontend/.output/server/index.mjs"
