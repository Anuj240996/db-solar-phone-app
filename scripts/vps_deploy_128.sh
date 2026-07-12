#!/bin/bash
set -e
SERVICE="db_solar_phone-app"
NEWIMG="easypanel/db_solar/phone-app:v128"
SRC="/root/phoneapp_new"

echo "=== Ensure source dir ==="
mkdir -p "$SRC"
if [ ! -f "$SRC/server.js" ]; then
  echo "Extracting from running container..."
  CID=$(docker ps -q -f name=db_solar_phone-app | head -1)
  docker cp "$CID:/app/." "$SRC/"
fi

echo "=== Overlay uploaded files ==="
cp -f /root/phoneapp_upload/server.js "$SRC/server.js"
cp -f /root/phoneapp_upload/routes/projects.js "$SRC/routes/projects.js"

echo "=== Verify local source ==="
grep "API_VERSION" "$SRC/server.js"
grep -n "release-agreement\|fetchReleaseAgreementMeta\|releaseAgreementPdfs" "$SRC/routes/projects.js" "$SRC/server.js" | head -20

echo "=== Build image ==="
docker build --build-arg CACHE_BUST=$(date +%s) -t "$NEWIMG" "$SRC" 2>&1 | tail -20

echo "=== Force stop-first update ==="
docker service update --update-order stop-first --image "$NEWIMG" --force "$SERVICE" 2>&1 | tail -5

echo "=== Wait ==="
sleep 15
docker service ps "$SERVICE" --no-trunc --format '{{.Name}} | {{.CurrentState}} | {{.Error}}' | head -5

echo "=== Health ==="
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  OUT=$(curl -s http://127.0.0.1:8080/api/health || true)
  echo "try $i: $OUT"
  echo "$OUT" | grep -q '1.2.8' && { echo "DEPLOY OK"; exit 0; }
  sleep 5
done
echo "DEPLOY CHECK FAILED"
exit 1
