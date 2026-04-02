#!/usr/bin/env bash

set -euo pipefail

docker compose exec -T mongodb mongosh --quiet --eval "try { rs.status() } catch (e) { rs.initiate({_id:'rs0', members:[{_id:0, host:'localhost:27017'}]}) }"

echo "Mongo replica set rs0 is initialized."
