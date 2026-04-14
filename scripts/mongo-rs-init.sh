#!/bin/bash
# Запускается MongoDB при первом старте (docker-entrypoint-initdb.d).
# Инициализирует replica set rs0 идемпотентно.
mongo --quiet --eval '
(function() {
  try { rs.status(); return; } catch(e) {}
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongodb:27017" }] });
  var d = new Date().getTime() + 30000;
  while (new Date().getTime() < d) {
    try { if (rs.status().myState === 1) break; } catch(e2) {}
    sleep(500);
  }
  print("Replica set rs0 initialized.");
})();
'
