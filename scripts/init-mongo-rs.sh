#!/usr/bin/env bash
#
# Инициализация replica set rs0 в контейнере mongodb из docker-compose.
# Ожидается, что MONGO_HOST и MONGO_PORT в переданном .env совпадают с тем, как приложение
# подключается к этой же БД (например 127.0.0.1 при пробросе порта).
# Если Prisma смотрит на удалённый Mongo — не запускайте этот скрипт к локальному compose.
#
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_ENV="${1:-backend/.env.production}"
if [[ ! -f "$COMPOSE_ENV" ]]; then
  echo "Файл не найден: ${COMPOSE_ENV}" >&2
  exit 1
fi

DC=(docker compose --env-file "$COMPOSE_ENV")

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$COMPOSE_ENV"
set +a

MH="${MONGO_HOST:-127.0.0.1}"
MP="${MONGO_PORT:-27017}"
MEMBER="${MH}:${MP}"

# После rs.initiate() конфиг не сразу доступен — без паузы rs.conf() даёт NotYetInitialized (код 94).
# Участник replica set должен совпадать с хостом в DATABASE_URL (MONGO_HOST:MONGO_PORT).
RS_JS=$(cat <<EOF
(function () {
  var memberHost = "${MEMBER}";
  var cfg;
  try {
    cfg = rs.conf();
  } catch (e) {
    rs.initiate({_id: "rs0", members: [{_id: 0, host: memberHost}]});
    var deadline = new Date().getTime() + 60000;
    while (new Date().getTime() < deadline) {
      try {
        var st = rs.status();
        if (st.myState === 1) {
          break;
        }
      } catch (e2) {}
      sleep(250);
    }
    cfg = rs.conf();
  }
  if (cfg.members[0].host !== memberHost) {
    cfg.members[0].host = memberHost;
    rs.reconfig(cfg, { force: true });
  }
})();
EOF
)

run_mongo() {
  if "${DC[@]}" exec -T mongodb mongosh --quiet --eval "1" >/dev/null 2>&1; then
    "${DC[@]}" exec -T mongodb mongosh --quiet --eval "$RS_JS"
  else
    "${DC[@]}" exec -T mongodb mongo --quiet --eval "$RS_JS"
  fi
}

run_mongo

echo "Mongo replica set rs0 is initialized for member ${MEMBER} (MONGO_HOST=${MH}, MONGO_PORT=${MP})."
