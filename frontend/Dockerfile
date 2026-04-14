# ─── Stage 1: сборка ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Prisma generate для frontend (FrontendSession).
ENV DATABASE_URL=mongodb://localhost:27017/dummy
RUN npx prisma generate

# Все runtimeConfig.public значения (NUXT_PUBLIC_*) переопределяются
# через env-переменные контейнера в runtime — без пересборки образа.
RUN NODE_OPTIONS=--max-old-space-size=3072 npx nuxt build

# ─── Stage 2: production ─────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Nitro bundler включает зависимости в .output/server/node_modules,
# но Prisma использует нативные бинарники — копируем node_modules для надёжности.
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
