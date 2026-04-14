# ─── Stage 1: сборка ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Prisma generate: DATABASE_URL нужен только для определения провайдера,
# реальное значение подставляется в runtime через переменную окружения.
ENV DATABASE_URL=mongodb://localhost:27017/dummy
RUN npx prisma generate

RUN npm run build

# ─── Stage 2: production ─────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 3000

CMD ["node", "dist/main"]
