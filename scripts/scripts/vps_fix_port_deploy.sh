#!/bin/bash
set -e
SERVICE="db_solar_phone-app"

echo "=== Set stop-first update policy (fixes host-port deploys permanently) ==="
docker service update --update-order stop-first --update-parallelism 1 "$SERVICE" >/dev/null 2>&1 || true

echo "=== Scale to 0 (free host port 8080) ==="
docker service scale "$SERVICE"=0
for i in $(seq 1 12); do
  RUN=$(docker ps --format '{{.Names}}' | grep phone-app || true)
  [ -z "$RUN" ] && { echo "port freed"; break; }
  echo "waiting for old task to stop..."; sleep 3
done

echo "=== Scale to 1 (start v127 with db_solar_v2 env) ==="
docker service scale "$SERVICE"=1
sleep 8

echo "=== Task status ==="
docker service ps "$SERVICE" --no-trunc --format '{{.Name}} | {{.Image}} | {{.CurrentState}} | {{.Error}}' | head -3

echo "=== Health check ==="
for i in $(seq 1 12); do
  OUT=$(curl -s http://127.0.0.1:8080/api/health || true)
  echo "try $i: $OUT"
  echo "$OUT" | grep -q '1.2.7' && { echo "DEPLOY OK"; break; }
  sleep 5
done

echo "=== Confirm DB in running container ==="
CID=$(docker ps --format '{{.ID}}' --filter name=phone-app | head -1)
if [ -n "$CID" ]; then
  docker exec "$CID" sh -lc 'printenv DATABASE_URL | sed -E "s/:[^:@]+@/:****@/"'
fi
