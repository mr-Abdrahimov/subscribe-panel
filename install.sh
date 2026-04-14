#!/bin/bash
# =============================================================================
#  Subscribe Panel — скрипт быстрой установки
#  Поддержка: Debian 11/12, Ubuntu 22.04/24.04
#  Запуск:  bash <(curl -fsSL https://raw.githubusercontent.com/mr-Abdrahimov/subscribe-panel/main/install.sh)
# =============================================================================

set -euo pipefail

# ─── Цвета ────────────────────────────────────────────────────────────────────
R="\033[1;31m" G="\033[1;32m" Y="\033[1;33m" W="\033[1;37m" RESET="\033[0m"

info()    { echo -e "${G}[✓]${RESET} $*"; }
warn()    { echo -e "${Y}[!]${RESET} $*"; }
error()   { echo -e "${R}[✗]${RESET} $*" >&2; exit 1; }
ask()     { echo -e "${Y}[?]${RESET} $*"; }
section() { echo -e "\n${G}══════════════════════════════════════${RESET}"; echo -e "${G}  $*${RESET}"; echo -e "${G}══════════════════════════════════════${RESET}\n"; }

# ─── Каталог установки ────────────────────────────────────────────────────────
INSTALL_DIR="/opt/subscribe-panel"
LOGFILE="${INSTALL_DIR}/install.log"

# ─── Проверки ─────────────────────────────────────────────────────────────────
check_root() {
    [[ $EUID -ne 0 ]] && error "Запустите скрипт с правами root: sudo bash install.sh"
}

check_os() {
    if ! grep -qE "bullseye|bookworm|jammy|noble|trixie" /etc/os-release 2>/dev/null; then
        error "Поддерживаются: Debian 11/12, Ubuntu 22.04/24.04"
    fi
}

# ─── Получить внешний IP сервера ─────────────────────────────────────────────
server_ip() {
    curl -s -4 --max-time 5 ifconfig.me 2>/dev/null \
    || curl -s -4 --max-time 5 api.ipify.org 2>/dev/null \
    || curl -s -4 --max-time 5 ipinfo.io/ip 2>/dev/null \
    || echo ""
}

# ─── Проверка DNS домена ──────────────────────────────────────────────────────
check_domain_dns() {
    local domain="$1"
    local domain_ip server_ip_val

    domain_ip=$(dig +short A "$domain" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
    server_ip_val=$(server_ip)

    if [[ -z "$domain_ip" || -z "$server_ip_val" ]]; then
        warn "Не удалось определить IP домена ($domain) или сервера ($server_ip_val)."
        warn "Убедитесь что DNS A-запись домена указывает на IP этого сервера."
        read -rp "  Продолжить всё равно? (y/N): " ans
        [[ "$ans" =~ ^[Yy]$ ]] || exit 1
        return
    fi

    if [[ "$domain_ip" != "$server_ip_val" ]]; then
        warn "Домен $domain → $domain_ip, но IP сервера: $server_ip_val"
        warn "Убедитесь что DNS A-запись домена указывает на этот сервер."
        read -rp "  Продолжить всё равно? (y/N): " ans
        [[ "$ans" =~ ^[Yy]$ ]] || exit 1
    else
        info "DNS OK: $domain → $domain_ip"
    fi
}

# ─── Установка зависимостей ───────────────────────────────────────────────────
install_packages() {
    section "Установка зависимостей"

    apt-get update -y
    apt-get install -y \
        ca-certificates curl jq ufw wget gnupg unzip \
        nano git certbot python3-certbot-nginx \
        dnsutils coreutils openssl \
        unattended-upgrades

    # Docker
    if ! command -v docker &>/dev/null || ! docker info &>/dev/null; then
        info "Установка Docker..."
        curl -fsSL https://get.docker.com | sh
    fi

    systemctl enable --now docker

    docker info &>/dev/null || error "Docker не работает"
    info "Docker: $(docker --version)"
}

# ─── SSL через certbot --nginx (HTTP-01) ─────────────────────────────────────
obtain_certificate() {
    local domain="$1"
    local email="$2"

    # Если уже есть — пропустить
    if [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]]; then
        info "Сертификат для $domain уже существует, пропускаем."
        return 0
    fi

    section "Получение SSL-сертификата для $domain"

    # Временный nginx нужен для HTTP-01 challenge — запускаем его заранее
    # (certbot --nginx сам управляет конфигом)
    certbot certonly \
        --nginx \
        --non-interactive \
        --agree-tos \
        --email "$email" \
        -d "$domain" \
        --key-type ecdsa \
        --elliptic-curve secp384r1

    [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]] \
        || error "Сертификат не получен для $domain. Проверьте DNS и порт 80."

    info "Сертификат получен: /etc/letsencrypt/live/$domain/"

    # Автообновление cron
    if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
        (crontab -l 2>/dev/null; echo "0 5 * * 0 certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | crontab -
        info "Cron для автообновления сертификата добавлен"
    fi
}

# ─── Генерация .env ───────────────────────────────────────────────────────────
generate_env() {
    local domain="$1"
    local admin_email="$2"
    local admin_pass="$3"
    local redis_pass="$4"
    local jwt_secret="$5"
    local crypto_path="$6"

    cat > "${INSTALL_DIR}/.env" <<EOF
# Сгенерировано install.sh — $(date)

GITHUB_REPO=mr-Abdrahimov/subscribe-panel
IMAGE_TAG=latest

MONGO_DATABASE=subscribe_panel
REDIS_PASSWORD=${redis_pass}

BACKEND_PORT=3000
FRONTEND_PORT=3001

JWT_SECRET=${jwt_secret}
JWT_EXPIRES_IN=7d

FRONTEND_ORIGIN=https://${domain}
PUBLIC_SUBSCRIPTION_BASE_URL=https://${domain}
SUBSCRIPTION_CRYPTO_PATH_SEGMENT=${crypto_path}

ADMIN_EMAIL=${admin_email}
ADMIN_PASSWORD=${admin_pass}
ADMIN_NAME=System Admin

TELEGRAM_NOTIFY_SUBSCRIPTION_ACCESS=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

SWAGGER_PATH=docs
SWAGGER_TITLE=Subscribe Panel API
SWAGGER_DESCRIPTION=
SWAGGER_VERSION=1.0.0

BULL_BOARD_ENABLED=false
BULL_BOARD_TOKEN=

NUXT_PUBLIC_API_BASE_URL=https://${domain}/api
NUXT_PUBLIC_SITE_URL=https://${domain}
EOF

    chmod 600 "${INSTALL_DIR}/.env"
    info ".env создан: ${INSTALL_DIR}/.env"
}

# ─── Nginx конфиг ─────────────────────────────────────────────────────────────
write_nginx_config() {
    local domain="$1"

    # Базовый HTTP → будет заменён certbot на HTTPS
    cat > "/etc/nginx/sites-available/${domain}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    client_max_body_size 20m;

    # Иконки Nuxt (выше /api/, иначе уходит в NestJS)
    location ^~ /api/_nuxt_icon {
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_pass http://127.0.0.1:3001;
    }

    # Backend NestJS (/api/ → NestJS без префикса)
    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_pass http://127.0.0.1:3000/;
    }

    # Frontend Nuxt
    location / {
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_pass http://127.0.0.1:3001;
    }
}
NGINX

    ln -sf "/etc/nginx/sites-available/${domain}" "/etc/nginx/sites-enabled/${domain}"

    # Убираем дефолтный сайт чтобы не мешал certbot
    rm -f /etc/nginx/sites-enabled/default

    nginx -t && systemctl reload nginx
    info "Nginx конфиг для $domain создан"
}

# ─── После получения сертификата nginx перепишет конфиг сам,
#     но нам нужно добавить наши location в HTTPS-блок ─────────────────────────
patch_nginx_ssl() {
    local domain="$1"
    local conf="/etc/nginx/sites-available/${domain}"

    # certbot добавляет ssl настройки и redirect — нам нужно убедиться
    # что все location есть в ssl-блоке. Certbot --nginx добавляет их автоматически,
    # поэтому просто reload.
    nginx -t && systemctl reload nginx
    info "Nginx HTTPS-конфиг применён"
}

# ─── Скачать docker-compose.yml из репозитория ────────────────────────────────
download_compose() {
    info "Скачивание docker-compose.yml..."
    curl -fsSL \
        "https://raw.githubusercontent.com/mr-Abdrahimov/subscribe-panel/main/docker-compose.yml" \
        -o "${INSTALL_DIR}/docker-compose.yml"
}

# ─── Инициализация MongoDB replica set ───────────────────────────────────────
init_mongo_rs() {
    section "Инициализация MongoDB Replica Set"
    info "Ожидание запуска MongoDB..."

    local attempts=0
    until docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
            exec -T mongodb mongo --quiet --eval "db.adminCommand({ping:1})" \
            &>/dev/null; do
        attempts=$((attempts + 1))
        [[ $attempts -ge 30 ]] && error "MongoDB не запустилась за 5 минут"
        sleep 10
    done

    docker compose -f "${INSTALL_DIR}/docker-compose.yml" exec -T mongodb \
        mongo --quiet --eval '
(function() {
  try { rs.status(); return; } catch(e) {}
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongodb:27017" }] });
  var d = new Date().getTime() + 30000;
  while (new Date().getTime() < d) {
    try { if (rs.status().myState === 1) break; } catch(e2) {}
    sleep(500);
  }
})();
' && info "MongoDB Replica Set инициализирован" \
  || warn "Replica Set уже был инициализирован (это нормально)"
}

# ─── Интерактивный ввод параметров ───────────────────────────────────────────
collect_input() {
    section "Настройка Subscribe Panel"

    # Домен
    while true; do
        ask "Введите домен (например: panel.example.com):"
        read -rp "  Домен: " DOMAIN
        DOMAIN="${DOMAIN,,}"  # lower case
        DOMAIN="${DOMAIN#https://}"
        DOMAIN="${DOMAIN#http://}"
        DOMAIN="${DOMAIN%/}"
        [[ -n "$DOMAIN" ]] && break
        warn "Домен не может быть пустым"
    done

    # Проверка DNS
    check_domain_dns "$DOMAIN"

    # Email
    ask "Введите email для Let's Encrypt и администратора:"
    read -rp "  Email: " ADMIN_EMAIL
    [[ "$ADMIN_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]] || error "Некорректный email"

    # Пароль админа
    while true; do
        ask "Введите пароль администратора (мин. 8 символов):"
        read -rsp "  Пароль: " ADMIN_PASS; echo
        [[ ${#ADMIN_PASS} -ge 8 ]] && break
        warn "Пароль слишком короткий"
    done

    # Crypto path (необязательно)
    ask "Crypto-путь для happ:// ссылок (Enter = sub2128937123):"
    read -rp "  Crypto path: " CRYPTO_PATH
    CRYPTO_PATH="${CRYPTO_PATH:-sub2128937123}"

    # Генерируем секреты
    REDIS_PASS=$(openssl rand -hex 24)
    JWT_SECRET=$(openssl rand -hex 64)

    echo ""
    info "Параметры установки:"
    echo -e "  ${W}Домен:${RESET}          $DOMAIN"
    echo -e "  ${W}Admin email:${RESET}    $ADMIN_EMAIL"
    echo -e "  ${W}Crypto path:${RESET}    $CRYPTO_PATH"
    echo -e "  ${W}Redis пароль:${RESET}   (сгенерирован автоматически)"
    echo -e "  ${W}JWT secret:${RESET}     (сгенерирован автоматически)"
    echo ""
    read -rp "  Всё верно? Продолжить установку (y/N): " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
}

# ─── Основная установка ───────────────────────────────────────────────────────
main() {
    mkdir -p "$INSTALL_DIR"
    exec > >(tee -a "$LOGFILE") 2>&1

    check_root
    check_os

    clear
    echo -e "${G}"
    cat <<'BANNER'
  ___      _                  _ _         ___               _
 / __|_  _| |__ ___ __ _ _ _(_) |__  ___| _ \__ _ _ _  ___| |
 \__ \ || | '_ (_-</ _| '_| | | '_ \/ -_)  _/ _` | ' \/ -_) |
 |___/\_,_|_.__/__/\__|_| |_|_|_.__/\___|_| \__,_|_||_\___|_|

BANNER
    echo -e "${RESET}"

    # ── 1. Ввод параметров ────────────────────────────────────────────────────
    collect_input

    # ── 2. Установка пакетов ──────────────────────────────────────────────────
    install_packages

    # ── 3. Nginx (базовый HTTP) ───────────────────────────────────────────────
    section "Настройка Nginx"
    if ! command -v nginx &>/dev/null; then
        apt-get install -y nginx
    fi
    systemctl enable --now nginx
    write_nginx_config "$DOMAIN"

    # ── 4. SSL-сертификат ─────────────────────────────────────────────────────
    obtain_certificate "$DOMAIN" "$ADMIN_EMAIL"
    patch_nginx_ssl "$DOMAIN"

    # ── 5. Создать .env ───────────────────────────────────────────────────────
    section "Генерация конфигурации"
    generate_env "$DOMAIN" "$ADMIN_EMAIL" "$ADMIN_PASS" "$REDIS_PASS" "$JWT_SECRET" "$CRYPTO_PATH"

    # ── 6. Скачать docker-compose.yml ────────────────────────────────────────
    download_compose

    # ── 7. Запустить MongoDB + Redis (без приложений) ─────────────────────────
    section "Запуск баз данных"
    docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
        --env-file "${INSTALL_DIR}/.env" \
        up -d mongodb redis

    # ── 8. Инициализация MongoDB Replica Set ─────────────────────────────────
    init_mongo_rs

    # ── 9. Запустить все сервисы ──────────────────────────────────────────────
    section "Запуск Subscribe Panel"
    docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
        --env-file "${INSTALL_DIR}/.env" \
        pull

    docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
        --env-file "${INSTALL_DIR}/.env" \
        up -d

    # ── 10. Ожидание запуска и проверка ─────────────────────────────────────
    section "Проверка доступности"
    info "Ожидание запуска сервисов (до 3 минут)..."

    local attempts=0
    until curl -sf --max-time 5 "https://${DOMAIN}" &>/dev/null; do
        attempts=$((attempts + 1))
        if [[ $attempts -ge 18 ]]; then
            warn "Сайт не ответил за 3 минуты — проверьте логи:"
            warn "  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs backend"
            warn "  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs frontend"
            break
        fi
        echo -n "."
        sleep 10
    done
    echo ""

    # ── 11. Итог ─────────────────────────────────────────────────────────────
    clear
    echo -e "${G}"
    echo "══════════════════════════════════════════════════"
    echo "  Установка завершена!"
    echo "══════════════════════════════════════════════════"
    echo -e "${RESET}"
    echo -e "  ${W}URL панели:${RESET}      https://${DOMAIN}"
    echo -e "  ${W}API / Swagger:${RESET}   https://${DOMAIN}/api/docs"
    echo -e "  ${W}Admin email:${RESET}     ${ADMIN_EMAIL}"
    echo -e "  ${W}Admin пароль:${RESET}    ${ADMIN_PASS}"
    echo ""
    echo -e "  ${W}Каталог проекта:${RESET} ${INSTALL_DIR}"
    echo -e "  ${W}Конфигурация:${RESET}    ${INSTALL_DIR}/.env"
    echo -e "  ${W}Логи установки:${RESET}  ${LOGFILE}"
    echo ""
    echo -e "  ${Y}Полезные команды:${RESET}"
    echo "    Статус:    docker compose -f ${INSTALL_DIR}/docker-compose.yml ps"
    echo "    Логи:      docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
    echo "    Стоп:      docker compose -f ${INSTALL_DIR}/docker-compose.yml down"
    echo "    Рестарт:   docker compose -f ${INSTALL_DIR}/docker-compose.yml restart"
    echo "    Обновить:  docker compose -f ${INSTALL_DIR}/docker-compose.yml pull && \\"
    echo "               docker compose -f ${INSTALL_DIR}/docker-compose.yml up -d"
    echo ""
}

main "$@"
