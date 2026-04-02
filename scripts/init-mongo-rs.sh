#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_ENV="${1:-backend/.env.production}"
DC=(docker compose --env-file "$COMPOSE_ENV")

# После rs.initiate() конфиг не сразу доступен — без паузы rs.conf() даёт NotYetInitialized (код 94).
RS_JS=$(cat <<'EOF'
(function () {
  var cfg;
  try {
    cfg = rs.conf();
  } catch (e) {
    rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]});
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
  if (cfg.members[0].host !== "localhost:27017") {
    cfg.members[0].host = "localhost:27017";
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

echo "Mongo replica set rs0 is initialized and configured for localhost:27017."
