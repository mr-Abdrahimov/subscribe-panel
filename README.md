# Subscribe Panel

Панель подписок: **NestJS** (API) + **Nuxt 4** (UI), **MongoDB** и **Redis** в Docker, **Prisma** для схемы БД.

## Требования на сервере

- Node.js (LTS, напр. 20+) и npm
- Docker и Docker Compose v2
- PM2 (глобально: `npm i -g pm2`)
- Nginx (для продакшена за обратным прокси)

Корень проекта в примерах ниже: `/var/www/subscribe-panel`. Если у вас другой путь — поправьте **`ecosystem.config.cjs`** (`cwd` у приложений PM2).

---

## Переменные окружения

Создайте и заполните (секреты не коммитить):

| Файл | Назначение |
|------|------------|
| `backend/.env.production` | `DATABASE_URL`, `JWT_*`, `FRONTEND_ORIGIN`, порты Mongo/Redis, админ для сида |
| `frontend/.env.production` | `NUXT_PUBLIC_API_BASE_URL` (в проде обычно `https://<ваш-домен>/api`) и учётные данные для автозаполнения формы входа при необходимости |

В репозитории есть примеры значений под домен **inv.avtlk.ru** и прокси `/api`.

---

## Запуск в продакшене (порядок действий)

### 1. MongoDB и Redis

Из корня репозитория:

```bash
cd /var/www/subscribe-panel
docker compose --env-file backend/.env.production pull
docker compose --env-file backend/.env.production up -d
docker ps
```

В `docker-compose.yml` по умолчанию **Mongo 4.4** (на части VPS образ **mongo:7** падает с кодом **132**). Порт Mongo на хосте задаётся **`MONGO_PORT`** в `backend/.env.production` (часто `27017`).

**Один раз** инициализируйте replica set (нужно для Prisma с MongoDB):

```bash
bash scripts/init-mongo-rs.sh
# при другом env-файле compose: bash scripts/init-mongo-rs.sh путь/к/.env
```

### 2. Схема БД (Prisma)

```bash
cd /var/www/subscribe-panel/backend
npm ci
npm run prisma:generate:prod
npm run prisma:push:prod
```

Либо без суффикса `:prod`, если на сервере есть только `.env.production` (скрипты сами подхватят его, если нет `.env.development`).

`DATABASE_URL` в `backend/.env.production` должен указывать на **хостовый** порт Mongo (например `mongodb://127.0.0.1:27017/...?replicaSet=rs0`), а не на имя контейнера — бэкенд и Prisma запускаются **на хосте**, не внутри Docker-сети compose.

### 3. Сборка бэкенда

```bash
cd /var/www/subscribe-panel/backend
NODE_ENV=production npm run build
```

### 4. Сборка фронтенда

```bash
cd /var/www/subscribe-panel/frontend
npm ci
npm run build
```

Должен появиться файл **`frontend/.output/server/index.mjs`**. Без успешной сборки **`npm run start:prod`** на фронте не запустится.

### 5. PM2 (бэкенд + фронтенд)

```bash
cd /var/www/subscribe-panel
pm2 start ecosystem.config.cjs
pm2 save
```

Обновление после деплоя:

```bash
cd /var/www/subscribe-panel/backend && npm ci && NODE_ENV=production npm run build
cd /var/www/subscribe-panel/frontend && npm ci && npm run build
pm2 reload ecosystem.config.cjs --update-env
```

Логи:

```bash
pm2 logs subscribe-backend
pm2 logs subscribe-frontend
```

### 6. Nginx

Конфиг сайта в репозитории: **`nginx/sites-available/inv.avtlk.ru.conf`** (только блок `server`).

```bash
sudo cp /var/www/subscribe-panel/nginx/sites-available/inv.avtlk.ru.conf /etc/nginx/sites-available/inv.avtlk.ru
sudo ln -sf /etc/nginx/sites-available/inv.avtlk.ru /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Конфиг Nginx содержит отдельный `location /api/_nuxt_icon/` на Nuxt: иначе запросы иконок попадали бы в Nest и отдавали 404 (префикс `/api/` общий). В **`nuxt.config.ts`** для фронта задан **`icon.localApiEndpoint: '/_nuxt_icon'`**, чтобы иконки шли на путь без конфликта с API. С главной снят **`prerender`** (раньше клиент запрашивал `/_payload.json` и получал 404 в этом сценарии).

Ожидается:

- фронт **Nitro** слушает **127.0.0.1:3001**;
- бэкенд **Nest** слушает **127.0.0.1:3000**;
- с внешнего URL сайт открывается как **https://inv.avtlk.ru**, API — **https://inv.avtlk.ru/api/** (префикс `/api` снимается прокси и не должен дублироваться в маршрутах Nest).

TLS (после того, как DNS указывает на сервер):

```bash
sudo certbot --nginx -d inv.avtlk.ru
```

### 7. Автозапуск PM2 после перезагрузки

```bash
pm2 save
pm2 startup
# выполните команду, которую выведет `pm2 startup`
```

---

## Краткая шпаргалка портов

| Сервис | Где слушает | Назначение |
|--------|-------------|------------|
| Nuxt (prod) | `0.0.0.0:3001` | PM2 → Nginx `proxy_pass` |
| Nest (prod) | `3000` (из `PORT` в `.env.production`) | Nginx `location /api/` |
| Mongo | `127.0.0.1:27017` (проброс из Docker) | Prisma, Nest |
| Redis | `6379` (проброс) | при необходимости для бэкенда |

---

## Swagger

У приложения **нет** глобального префикса `/api` в коде: Nginx отдаёт на Nest пути без префикса `/api`. Путь Swagger задаётся **`SWAGGER_PATH`** в `backend/.env.production` (по умолчанию `docs`).

Примеры:

- локально: `http://127.0.0.1:3000/docs`
- за Nginx с доменом **inv.avtlk.ru**: `https://inv.avtlk.ru/api/docs`
