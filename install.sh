#!/bin/bash
# =============================================================================
#  Subscribe Panel — скрипт быстрой установки
#  Поддержка: Debian 11/12, Ubuntu 22.04/24.04
#  Запуск:  bash <(curl -fsSL https://raw.githubusercontent.com/mr-Abdrahimov/subscribe-panel/main/install.sh)
# =============================================================================

R="\033[1;31m" G="\033[1;32m" Y="\033[1;33m" W="\033[1;37m" RESET="\033[0m"

info()    { echo -e "${G}[✓]${RESET} $*"; }
warn()    { echo -e "${Y}[!]${RESET} $*"; }
err()     { echo -e "${R}[✗]${RESET} $*" >&2; exit 1; }
section() {
    echo -e "\n${G}══════════════════════════════════════${RESET}"
    echo -e "${G}  $*${RESET}"
    echo -e "${G}══════════════════════════════════════${RESET}\n"
}

# ─── Глобальные переменные ────────────────────────────────────────────────────
INSTALL_DIR="/opt/subscribe-panel"
DOMAIN=""
ADMIN_EMAIL=""
ADMIN_PASS=""
CRYPTO_PATH="sub2128937123"
REDIS_PASS=""
JWT_SECRET=""

# ─── Проверки ─────────────────────────────────────────────────────────────────
check_root() {
    if [[ $EUID -ne 0 ]]; then
        err "Запустите скрипт с правами root:  sudo bash install.sh"
    fi
}

check_os() {
    if ! grep -qE "bullseye|bookworm|jammy|noble|trixie" /etc/os-release 2>/dev/null; then
        err "Поддерживаются: Debian 11/12, Ubuntu 22.04/24.04"
    fi
}

# ─── Получить внешний IP сервера ──────────────────────────────────────────────
get_server_ip() {
    curl -s -4 --max-time 5 ifconfig.me 2>/dev/null \
    || curl -s -4 --max-time 5 api.ipify.org 2>/dev/null \
    || curl -s -4 --max-time 5 ipinfo.io/ip 2>/dev/null \
    || echo ""
}

# ─── Проверка DNS ─────────────────────────────────────────────────────────────
check_domain_dns() {
    local domain="$1"
    local domain_ip server_ip_val confirm

    domain_ip=$(dig +short A "$domain" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
    server_ip_val=$(get_server_ip)

    if [[ -z "$domain_ip" || -z "$server_ip_val" ]]; then
        warn "Не удалось определить IP домена или сервера."
        warn "Убедитесь что DNS A-запись домена указывает на IP этого сервера."
        read -rp "  Продолжить всё равно? (y/N): " confirm
        [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
        return
    fi

    if [[ "$domain_ip" != "$server_ip_val" ]]; then
        warn "Домен $domain → $domain_ip, но IP сервера: $server_ip_val"
        warn "Убедитесь что DNS A-запись домена указывает на этот сервер."
        read -rp "  Продолжить всё равно? (y/N): " confirm
        [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
    else
        info "DNS OK: $domain → $domain_ip"
    fi
}

# ─── Установка пакетов и Docker ───────────────────────────────────────────────
install_packages() {
    section "Установка зависимостей"

    apt-get update -y
    apt-get install -y \
        ca-certificates curl jq ufw wget gnupg unzip \
        nano git certbot python3-certbot-nginx \
        dnsutils coreutils openssl nginx \
        unattended-upgrades

    if ! command -v docker &>/dev/null || ! docker info &>/dev/null; then
        info "Установка Docker..."
        curl -fsSL https://get.docker.com | sh
    fi

    systemctl enable --now docker
    docker info &>/dev/null || err "Docker не работает"
    info "Docker: $(docker --version)"
}

# ─── Nginx конфиг ─────────────────────────────────────────────────────────────
write_nginx_config() {
    local domain="$1"

    cat > "/etc/nginx/sites-available/${domain}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    client_max_body_size 20m;

    # Иконки Nuxt (приоритет выше /api/, иначе уходит в NestJS)
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

    # Backend NestJS — /api/ → NestJS (без префикса /api)
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

    rm -f /etc/nginx/sites-enabled/default
    ln -sf "/etc/nginx/sites-available/${domain}" "/etc/nginx/sites-enabled/${domain}"
    nginx -t && systemctl reload nginx
    info "Nginx конфиг для $domain создан"
}

# ─── SSL-сертификат ───────────────────────────────────────────────────────────
obtain_certificate() {
    local domain="$1"
    local email="$2"

    if [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]]; then
        info "Сертификат для $domain уже существует, пропускаем."
        return 0
    fi

    section "Получение SSL-сертификата для $domain"

    certbot --nginx \
        --non-interactive \
        --agree-tos \
        --email "$email" \
        -d "$domain" \
        --key-type ecdsa \
        --elliptic-curve secp384r1

    if [[ ! -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]]; then
        err "Сертификат не получен для $domain. Проверьте что DNS настроен и порт 80 открыт."
    fi

    info "Сертификат получен: /etc/letsencrypt/live/$domain/"

    if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
        (crontab -l 2>/dev/null; echo "0 5 * * 0 certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | crontab -
        info "Cron для автообновления сертификата добавлен"
    fi
}

# ─── Генерация .env ───────────────────────────────────────────────────────────
generate_env() {
    cat > "${INSTALL_DIR}/.env" <<EOF
# Сгенерировано install.sh — $(date)

GITHUB_REPO=mr-Abdrahimov/subscribe-panel
IMAGE_TAG=latest

MONGO_DATABASE=subscribe_panel
REDIS_PASSWORD=${REDIS_PASS}

BACKEND_PORT=3000
FRONTEND_PORT=3001

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

FRONTEND_ORIGIN=https://${DOMAIN}
PUBLIC_SUBSCRIPTION_BASE_URL=https://${DOMAIN}
SUBSCRIPTION_CRYPTO_PATH_SEGMENT=${CRYPTO_PATH}

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASS}
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

NUXT_PUBLIC_API_BASE_URL=https://${DOMAIN}/api
NUXT_PUBLIC_SITE_URL=https://${DOMAIN}
EOF

    chmod 600 "${INSTALL_DIR}/.env"
    info ".env создан: ${INSTALL_DIR}/.env"
}

# ─── Скачать docker-compose.yml ───────────────────────────────────────────────
download_compose() {
    info "Скачивание docker-compose.yml..."
    curl -fsSL \
        "https://raw.githubusercontent.com/mr-Abdrahimov/subscribe-panel/main/docker-compose.yml" \
        -o "${INSTALL_DIR}/docker-compose.yml"
}

# ─── Инициализация MongoDB Replica Set ───────────────────────────────────────
init_mongo_rs() {
    section "Инициализация MongoDB Replica Set"
    info "Ожидание запуска MongoDB..."

    local attempts=0
    until docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
            exec -T mongodb mongo --quiet --eval "db.adminCommand({ping:1})" \
            &>/dev/null; do
        attempts=$((attempts + 1))
        if [[ $attempts -ge 30 ]]; then
            err "MongoDB не запустилась за 5 минут"
        fi
        echo -n "."
        sleep 10
    done
    echo ""

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
  || warn "Replica Set уже был инициализирован"
}

# ─── Ввод параметров ──────────────────────────────────────────────────────────
collect_input() {
    section "Настройка Subscribe Panel"

    # Домен
    while true; do
        echo -e "${Y}[?]${RESET} Введите домен (например: panel.example.com):"
        read -rp "  Домен: " DOMAIN
        DOMAIN="${DOMAIN,,}"
        DOMAIN="${DOMAIN#https://}"
        DOMAIN="${DOMAIN#http://}"
        DOMAIN="${DOMAIN%/}"
        [[ -n "$DOMAIN" ]] && break
        warn "Домен не может быть пустым"
    done

    check_domain_dns "$DOMAIN"

    # Email
    while true; do
        echo -e "${Y}[?]${RESET} Введите email (для Let's Encrypt и администратора панели):"
        read -rp "  Email: " ADMIN_EMAIL
        [[ "$ADMIN_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]] && break
        warn "Некорректный email, попробуйте ещё раз"
    done

    # Пароль
    while true; do
        echo -e "${Y}[?]${RESET} Введите пароль администратора (мин. 8 символов):"
        read -rsp "  Пароль: " ADMIN_PASS; echo
        [[ ${#ADMIN_PASS} -ge 8 ]] && break
        warn "Пароль слишком короткий (мин. 8 символов)"
    done

    # Crypto path
    echo -e "${Y}[?]${RESET} Crypto-сегмент для happ:// ссылок (Enter = sub2128937123):"
    read -rp "  Crypto path: " _cp
    CRYPTO_PATH="${_cp:-sub2128937123}"

    # Генерируем секреты
    REDIS_PASS=$(openssl rand -hex 24)
    JWT_SECRET=$(openssl rand -hex 64)

    echo ""
    info "Параметры установки:"
    echo -e "  ${W}Домен:${RESET}        $DOMAIN"
    echo -e "  ${W}Email:${RESET}        $ADMIN_EMAIL"
    echo -e "  ${W}Crypto path:${RESET}  $CRYPTO_PATH"
    echo ""
    read -rp "  Всё верно? Начать установку (y/N): " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
}

# ─── Основной поток ───────────────────────────────────────────────────────────
main() {
    check_root
    check_os

    clear
    echo -e "${G}"
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║     Subscribe Panel — Установка       ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo -e "${RESET}"

    collect_input

    mkdir -p "$INSTALL_DIR"

    # Лог в файл (после mkdir)
    exec > >(tee -a "${INSTALL_DIR}/install.log") 2>&1

    install_packages

    section "Настройка Nginx"
    systemctl enable --now nginx
    write_nginx_config "$DOMAIN"

    obtain_certificate "$DOMAIN" "$ADMIN_EMAIL"

    section "Генерация конфигурации"
    generate_env

    download_compose

    section "Запуск баз данных"
    docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
        --env-file "${INSTALL_DIR}/.env" \
        up -d mongodb redis

    init_mongo_rs

    section "Запуск Subscribe Panel"
    docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
        --env-file "${INSTALL_DIR}/.env" \
        pull

    docker compose -f "${INSTALL_DIR}/docker-compose.yml" \
        --env-file "${INSTALL_DIR}/.env" \
        up -d

    section "Проверка доступности"
    info "Ожидание запуска сервисов (до 3 минут)..."
    local attempts=0
    until curl -sf --max-time 5 "https://${DOMAIN}" &>/dev/null; do
        attempts=$((attempts + 1))
        if [[ $attempts -ge 18 ]]; then
            warn "Сайт пока не отвечает — это может быть нормально если образы ещё скачиваются."
            warn "Проверьте через пару минут: https://${DOMAIN}"
            warn "Логи: docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
            break
        fi
        echo -n "."
        sleep 10
    done
    echo ""

    clear
    echo -e "${G}"
    echo "  ╔═══════════════════════════════════════════════╗"
    echo "  ║         Установка завершена успешно!          ║"
    echo "  ╚═══════════════════════════════════════════════╝"
    echo -e "${RESET}"
    echo -e "  ${W}URL панели:${RESET}      https://${DOMAIN}"
    echo -e "  ${W}API / Swagger:${RESET}   https://${DOMAIN}/api/docs"
    echo -e "  ${W}Admin email:${RESET}     ${ADMIN_EMAIL}"
    echo -e "  ${W}Admin пароль:${RESET}    ${ADMIN_PASS}"
    echo ""
    echo -e "  ${W}Конфигурация:${RESET}    ${INSTALL_DIR}/.env"
    echo -e "  ${W}Логи установки:${RESET}  ${INSTALL_DIR}/install.log"
    echo ""
    echo -e "  ${Y}Полезные команды:${RESET}"
    echo "    Статус:    docker compose -f ${INSTALL_DIR}/docker-compose.yml ps"
    echo "    Логи:      docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
    echo "    Обновить:  docker compose -f ${INSTALL_DIR}/docker-compose.yml pull && \\"
    echo "               docker compose -f ${INSTALL_DIR}/docker-compose.yml up -d"
    echo ""
}

main "$@"
