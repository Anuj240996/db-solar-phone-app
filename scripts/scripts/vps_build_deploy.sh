#!/bin/bash
set -e

SERVICE="db_solar_phone-app"
NEWIMG="easypanel/db_solar/phone-app:v127"
SRC="/root/phoneapp_new"

echo "=== Build fresh image from source ==="
docker build --build-arg CACHE_BUST=$(date +%s) -t "$NEWIMG" "$SRC" 2>&1 | tail -15

echo "=== Verify image code ==="
docker run --rm --entrypoint sh "$NEWIMG" -lc 'grep API_VERSION /app/server.js; ls /app/utils/buildProjectProgress.js'

echo "=== Update swarm service to new image ==="
docker service update --image "$NEWIMG" --force "$SERVICE" 2>&1 | tail -3

echo "=== Wait for task ==="
sleep 12
docker service ps "$SERVICE" --no-trunc --format '{{.Name}} | {{.CurrentState}} | {{.Error}}' | head -4

echo "=== Health check ==="
for i in 1 2 3 4 5 6 7 8 9 10; do
  OUT=$(curl -s http://127.0.0.1:8080/api/health || true)
  echo "try $i: $OUT"
  echo "$OUT" | grep -q '1.2.7' && { echo "DEPLOY OK"; break; }
  sleep 5
done
