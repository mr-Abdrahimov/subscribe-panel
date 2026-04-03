#!/usr/bin/env bash
# Продакшен-деплой: backend + frontend + PM2.
#
# Запуск из корня репозитория:
#   sh deploy.sh
# Через sh скрипт при необходимости перезапускается в bash.
# Допустимо также: ./deploy.sh или bash deploy.sh
#
# Prisma Client (prisma generate) для backend и frontend выполняется при КАЖДОМ деплое.
# DATABASE_URL для Prisma CLI берётся из backend/.env.production через npm-скрипты
# (backend/scripts/print-mongo-database-url.mjs: MONGO_* или DATABASE_URL в том же файле).
#
# Опционально применить схему к БД (осторожно на проде):
#   ./deploy.sh --prisma-push
#   или: DEPLOY_PRISMA_PUSH=1 ./deploy.sh
#
# Требования: Node.js, npm, pm2, bash; в ecosystem.config.cjs пути cwd должны совпадать с этим сервером.

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Не экспортировать NODE_ENV=production до npm ci: иначе npm опускает devDependencies,
# а в backend нужны dotenv-cli, @nestjs/cli, typescript и т.д.
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

echo "==> git pull"
cd "${ROOT}"
git pull

echo "==> Backend: npm ci (включая devDependencies для сборки и Prisma)"
cd "${ROOT}/backend"
npm ci --include=dev

echo "==> Backend: Prisma generate (всегда)"
npm run prisma:generate:prod

if [[ "${PRISMA_PUSH}" -eq 1 ]]; then
  echo "==> Backend: prisma db push (опционально)"
  npm run prisma:push:prod
fi

echo "==> Backend: build"
NODE_ENV=production npm run build

echo "==> Frontend: npm ci (включая devDependencies)"
cd "${ROOT}/frontend"
npm ci --include=dev

echo "==> Frontend: Prisma generate (всегда)"
npm run prisma:generate:prod

echo "==> Frontend: build"
NODE_ENV=production npm run build

echo "==> PM2"
ECOSYSTEM="${ROOT}/ecosystem.config.cjs"
if pm2 describe subscribe-backend >/dev/null 2>&1; then
  pm2 reload "${ECOSYSTEM}" --update-env
else
  pm2 start "${ECOSYSTEM}"
fi

echo "==> Готово."
