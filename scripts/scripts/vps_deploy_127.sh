#!/bin/bash
set -e

SERVICE="db_solar_phone-app"
NEWIMG="easypanel/db_solar/phone-app:v127"
SRC="/root/phoneapp_new"

CID=$(docker ps --format '{{.ID}} {{.Names}}' | grep phone-app | awk '{print $1}' | head -1)
echo "Container: $CID"

echo "=== Clean nested junk from prior attempt ==="
docker exec "$CID" sh -lc 'rm -rf /app/utils/utils /app/routes/routes /app/database/database /app/middleware/middleware /app/scripts/scripts 2>/dev/null; true'

echo "=== Merge-copy new code into /app ==="
docker cp "$SRC/." "$CID:/app/"

echo "=== Verify key files ==="
docker exec "$CID" sh -lc 'grep API_VERSION /app/server.js; echo -n "buildProjectProgress: "; ls /app/utils/buildProjectProgress.js; echo -n "services route: "; ls /app/routes/services.js; echo -n "appAccess: "; ls /app/utils/appAccess.js'

echo "=== Install prod deps ==="
docker exec "$CID" sh -lc 'cd /app && npm ci --omit=dev 2>&1 | tail -4'

echo "=== Commit new image ==="
docker commit "$CID" "$NEWIMG" >/dev/null
echo "Committed $NEWIMG"

echo "=== Update swarm service (applies db_solar_v2 env from spec) ==="
docker service update --image "$NEWIMG" --force "$SERVICE" >/dev/null 2>&1 || \
  docker service update --image "$NEWIMG" --force "$SERVICE" 2>&1 | tail -3
echo "Service update done."

echo "=== Wait for task ==="
sleep 12
docker service ps "$SERVICE" --no-trunc --format '{{.Name}} | {{.CurrentState}} | {{.Error}}' | head -4

echo "=== Health check ==="
for i in 1 2 3 4 5 6 7 8; do
  OUT=$(curl -s http://127.0.0.1:8080/api/health || true)
  echo "try $i: $OUT"
  echo "$OUT" | grep -q '1.2.7' && { echo "DEPLOY OK"; break; }
  sleep 5
done
