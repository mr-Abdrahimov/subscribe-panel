#!/usr/bin/env bash
# Продакшен-деплой: backend + frontend + PM2.
#
# Запуск (из любой директории):
#   chmod +x deploy.sh   # один раз
#   ./deploy.sh
#
# Prisma Client (prisma generate) для backend и frontend выполняется при КАЖДОМ деплое.
#
# Опционально применить схему к БД (осторожно на проде):
#   ./deploy.sh --prisma-push
#   или: DEPLOY_PRISMA_PUSH=1 ./deploy.sh
#
# Требования: Node.js, npm, pm2; в ecosystem.config.cjs пути cwd должны совпадать с этим сервером.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export NODE_ENV="${NODE_ENV:-production}"

PRISMA_PUSH=0
for arg in "$@"; do
  if [[ "$arg" == "--prisma-push" ]]; then
    PRISMA_PUSH=1
  fi
done
if [[ "${DEPLOY_PRISMA_PUSH:-}" == "1" ]]; then
  PRISMA_PUSH=1
fi

echo "==> Корень проекта: ${ROOT}"

echo "==> Backend: npm ci"
cd "${ROOT}/backend"
npm ci

echo "==> Backend: Prisma generate (всегда)"
npm run prisma:generate:prod

if [[ "${PRISMA_PUSH}" -eq 1 ]]; then
  echo "==> Backend: prisma db push (опционально)"
  npm run prisma:push:prod
fi

echo "==> Backend: build"
npm run build

echo "==> Frontend: npm ci"
cd "${ROOT}/frontend"
npm ci

echo "==> Frontend: Prisma generate (всегда)"
npm run prisma:generate:prod

echo "==> Frontend: build"
npm run build

echo "==> PM2"
ECOSYSTEM="${ROOT}/ecosystem.config.cjs"
if pm2 describe subscribe-backend >/dev/null 2>&1; then
  pm2 reload "${ECOSYSTEM}" --update-env
else
  pm2 start "${ECOSYSTEM}"
fi

echo "==> Готово."
