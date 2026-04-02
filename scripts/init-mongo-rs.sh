#!/usr/bin/env bash

set -euo pipefail

# mongo:7 — mongosh; mongo:4.4 — только legacy-клиент mongo
docker compose exec -T mongodb sh -c '
  if command -v mongosh >/dev/null 2>&1; then
    CLI=mongosh
  else
    CLI=mongo
  fi
  "$CLI" --quiet --eval "
try {
  rs.status();
} catch (e) {
  rs.initiate({_id:'\''rs0'\'', members:[{_id:0, host:'\''localhost:27017'\''}]});
}

cfg = rs.conf();
if (cfg.members[0].host !== '\''localhost:27017'\'') {
  cfg.members[0].host = '\''localhost:27017'\'';
  rs.reconfig(cfg, { force: true });
}
"
'

echo "Mongo replica set rs0 is initialized and configured for localhost:27017."
