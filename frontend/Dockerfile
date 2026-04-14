# ─── Stage 1: сборка ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# NUXT_PUBLIC_SUBSCRIPTION_CRYPTO_PATH используется в nuxt.config.ts в routeRules —
# он вычисляется во время сборки, поэтому передаётся как build arg.
ARG NUXT_PUBLIC_SUBSCRIPTION_CRYPTO_PATH=sub2128937123
ENV NUXT_PUBLIC_SUBSCRIPTION_CRYPTO_PATH=${NUXT_PUBLIC_SUBSCRIPTION_CRYPTO_PATH}

COPY package*.json ./
RUN npm ci

COPY . .

# Prisma generate для frontend (FrontendSession).
ENV DATABASE_URL=mongodb://localhost:27017/dummy
RUN npx prisma generate

# Сборка Nuxt без --dotenv: env-переменные передаются через ENV выше и ARG.
# Остальные runtimeConfig.public переменные можно переопределить в runtime
# через NUXT_PUBLIC_* без пересборки образа.
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
