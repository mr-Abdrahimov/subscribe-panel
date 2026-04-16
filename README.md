# Subscribe Panel

Панель управления подписками на базе **NestJS** (API) + **Nuxt 4** (UI), **MongoDB** и **Redis**.

---

## Стек

| Слой | Технология |
|------|-----------|
| Backend | NestJS, Prisma, BullMQ |
| Frontend | Nuxt 4, Nuxt UI, Tailwind 4 |
| База данных | MongoDB 4.4 (Replica Set) |
| Очередь | Redis 7 + BullMQ |
| Инфраструктура | Docker Compose, Nginx, Let's Encrypt |

---

## Быстрая установка на сервер

> Поддерживаются: **Debian 11/12**, **Ubuntu 22.04/24.04**  
> Требования: root-доступ, открытые порты **80** и **443**, DNS домена указывает на сервер.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/mr-Abdrahimov/subscribe-panel/main/install.sh)
```

### Быстрый метод обновления версии (одной командой)

```bash
docker compose -f /opt/subscribe-panel/docker-compose.yml pull backend frontend \
  && docker compose -f /opt/subscribe-panel/docker-compose.yml up -d --no-deps backend frontend
```

Скрипт автоматически:

1. Устанавливает Docker, Nginx, Certbot
2. Спрашивает домен, email и пароль администратора
3. Получает SSL-сертификат Let's Encrypt
4. Настраивает Nginx с HTTPS и reverse proxy
5. Запускает MongoDB, Redis, backend, frontend через Docker Compose
6. Инициализирует MongoDB Replica Set
7. Выводит URL панели, логин и пароль

После завершения установки панель доступна по адресу `https://ВАШ_ДОМЕН`.

---

## Ручная установка

### 1. Клонировать репозиторий

```bash
git clone https://github.com/mr-Abdrahimov/subscribe-panel.git /opt/subscribe-panel
cd /opt/subscribe-panel
```

### 2. Создать `.env`

```bash
cp .env.example .env
nano .env
```

Обязательно заполните:

| Переменная | Описание |
|-----------|----------|
| `DOMAIN` | Домен панели (используется в nginx и certbot) |
| `JWT_SECRET` | Случайная строка: `openssl rand -hex 64` |
| `REDIS_PASSWORD` | Пароль Redis: `openssl rand -hex 24` |
| `FRONTEND_ORIGIN` | `https://ВАШ_ДОМЕН` |
| `NUXT_PUBLIC_API_BASE_URL` | `https://ВАШ_ДОМЕН/api` |
| `ADMIN_EMAIL` | Email первого администратора |
| `ADMIN_PASSWORD` | Пароль первого администратора |

### 3. Запустить

```bash
docker compose pull
docker compose up -d

# Инициализировать MongoDB Replica Set (один раз)
docker compose exec mongodb mongo --quiet --eval '
  (function() {
    try { rs.status(); return; } catch(e) {}
    rs.initiate({_id:"rs0",members:[{_id:0,host:"mongodb:27017"}]});
  })();
'
```

### 4. Настроить Nginx + SSL

```bash
# Установить nginx и certbot
apt-get install -y nginx certbot python3-certbot-nginx

# Создать конфиг
cat > /etc/nginx/sites-available/ВАШ_ДОМЕН <<'NGINX'
server {
    listen 80;
    server_name ВАШ_ДОМЕН;
    location ^~ /api/_nuxt_icon {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/ВАШ_ДОМЕН /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Получить SSL сертификат
certbot certonly --nginx --non-interactive --agree-tos \
  -m ВАШ_EMAIL -d ВАШ_ДОМЕН
```

---

## Обновление

### Обновить образы (рекомендуется)

```bash
cd /opt/subscribe-panel

# Скачать новые образы
docker compose pull

# Перезапустить с новыми образами (без остановки БД)
docker compose up -d --no-deps backend frontend
```

### Полный перезапуск всего стека

```bash
cd /opt/subscribe-panel
docker compose pull
docker compose up -d
```

### Проверить статус после обновления

```bash
docker compose ps
docker compose logs --tail=50 backend
docker compose logs --tail=50 frontend
```

---

## Полезные команды

### Статус контейнеров

```bash
docker compose -f /opt/subscribe-panel/docker-compose.yml ps
```

### Логи в реальном времени

```bash
# Все сервисы
docker compose -f /opt/subscribe-panel/docker-compose.yml logs -f

# Только backend
docker compose -f /opt/subscribe-panel/docker-compose.yml logs -f backend

# Только frontend
docker compose -f /opt/subscribe-panel/docker-compose.yml logs -f frontend
```

### Остановить / Запустить

```bash
# Остановить всё
docker compose -f /opt/subscribe-panel/docker-compose.yml down

# Запустить снова
docker compose -f /opt/subscribe-panel/docker-compose.yml up -d
```

### Перезапустить отдельный сервис

```bash
docker compose -f /opt/subscribe-panel/docker-compose.yml restart backend
docker compose -f /opt/subscribe-panel/docker-compose.yml restart frontend
```

### Просмотр конфигурации

```bash
cat /opt/subscribe-panel/.env
```

---

## Резервное копирование базы данных

### Создать бэкап

```bash
cd /opt/subscribe-panel

# Создать дамп в виде сжатого архива
docker compose exec mongodb mongodump \
  --db subscribe_panel \
  --archive \
  --gzip > backup_$(date +%Y%m%d_%H%M%S).gz
```

Файл `backup_YYYYMMDD_HHMMSS.gz` появится в текущей директории (`/opt/subscribe-panel`).

### Скачать бэкап на локальную машину

```bash
scp root@ВАШ_ДОМЕН:/opt/subscribe-panel/backup_*.gz ./
```

### Восстановить из бэкапа

```bash
cd /opt/subscribe-panel

# Восстановить из архива (заменить имя файла)
docker compose exec -T mongodb mongorestore \
  --db subscribe_panel \
  --archive \
  --gzip < backup_YYYYMMDD_HHMMSS.gz
```

> **Внимание:** восстановление перезаписывает текущие данные. Перед восстановлением рекомендуется сделать свежий бэкап.

### Очистка старых бэкапов

```bash
# Удалить бэкапы старше 7 дней
find /opt/subscribe-panel -name 'backup_*.gz' -mtime +7 -delete
```

---

## Структура проекта

```
subscribe-panel/
├── backend/              # NestJS API
│   ├── src/
│   ├── prisma/           # Схема MongoDB
│   └── Dockerfile
├── frontend/             # Nuxt 4 UI
│   ├── app/
│   ├── prisma/           # FrontendSession
│   └── Dockerfile
├── nginx/                # Пример конфига nginx
├── scripts/              # Вспомогательные скрипты
├── docker-compose.yml    # Продакшен стек
├── docker-compose.build.yml  # Override для локальной сборки
├── install.sh            # Скрипт быстрой установки
└── .env.example          # Шаблон переменных окружения
```

---

## Порты

| Сервис | Порт на хосте | Описание |
|--------|--------------|----------|
| Frontend (Nuxt) | `127.0.0.1:3001` | Nginx проксирует `/` сюда |
| Backend (NestJS) | `127.0.0.1:3000` | Nginx проксирует `/api/` сюда |
| MongoDB | внутри Docker-сети | Доступен только контейнерам |
| Redis | внутри Docker-сети | Доступен только контейнерам |

Оба приложения слушают только `127.0.0.1` — снаружи доступны только через Nginx.

---

## API документация (Swagger)

После установки документация доступна по адресу:

```
https://ВАШ_ДОМЕН/api/docs
```

---

## Локальная разработка

### Требования

- Node.js 22+, npm 11+
- Docker и Docker Compose v2

### Запуск

```bash
# 1. Поднять MongoDB и Redis
docker compose up -d mongodb redis

# 2. Инициализировать Replica Set (один раз)
docker compose exec mongodb mongo --quiet --eval \
  'try{rs.status()}catch(e){rs.initiate({_id:"rs0",members:[{_id:0,host:"mongodb:27017"}]})}'

# 3. Backend
cd backend
npm install
npm run prisma:generate
npm run start:dev

# 4. Frontend (в отдельном терминале)
cd frontend
npm install
npm run prisma:generate
npm run dev
```

Фронтенд: http://localhost:3001  
Backend API: http://localhost:3000  
Swagger: http://localhost:3000/docs

### Локальная сборка Docker образов

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```
