#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_ENV="${1:-backend/.env.production}"
DC=(docker compose --env-file "$COMPOSE_ENV")

# mongo:7 — mongosh; mongo:4.4 — только клиент mongo
RS_JS='try { rs.status(); } catch (e) { rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]}); } var cfg = rs.conf(); if (cfg.members[0].host !== "localhost:27017") { cfg.members[0].host = "localhost:27017"; rs.reconfig(cfg, { force: true }); }'

if "${DC[@]}" exec -T mongodb mongosh --quiet --eval "1" >/dev/null 2>&1; then
  "${DC[@]}" exec -T mongodb mongosh --quiet --eval "$RS_JS"
else
  "${DC[@]}" exec -T mongodb mongo --quiet --eval "$RS_JS"
fi

echo "Mongo replica set rs0 is initialized and configured for localhost:27017."
