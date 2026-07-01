#!/bin/bash
# Run ON THE VPS (root@72.60.98.248) after uploading backend/ to /root/db_solar_backend
set -euo pipefail

APP_DIR="${1:-/root/db_solar_backend}"
CONTAINER_ARG="${2:-}"

if [ ! -f "$APP_DIR/server.js" ]; then
  echo "Missing $APP_DIR/server.js — upload backend folder first."
  exit 1
fi

if [ -n "$CONTAINER_ARG" ]; then
  CONTAINER="$CONTAINER_ARG"
else
  CONTAINER=$(docker ps --format '{{.Names}}' | grep phone-app | head -1 || true)
fi

if [ -z "$CONTAINER" ]; then
  echo "No running phone-app container found. Run: docker ps"
  exit 1
fi

echo "Using container: $CONTAINER"
echo "Copying backend into container $CONTAINER ..."
docker cp "$APP_DIR/." "$CONTAINER:/app/"

echo "Restarting $CONTAINER ..."
docker restart "$CONTAINER"

sleep 3
echo "Health check:"
curl -s "http://127.0.0.1:8080/api/health" || true
echo ""
echo "Services route (expect 401 without token, not 404):"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8080/api/services" || true
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8080/api/complaints/service-requests" || true
