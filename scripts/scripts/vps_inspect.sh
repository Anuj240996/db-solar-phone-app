#!/bin/bash
set -e

CID=$(docker ps --format '{{.ID}} {{.Names}}' | grep phone-app | awk '{print $1}' | head -1)
if [ -z "$CID" ]; then
  echo "ERROR: phone-app container not found"
  exit 1
fi
echo "=== Container: $CID ==="

echo "--- workdir + files ---"
docker exec "$CID" sh -lc 'pwd; ls -la /app | head -40'

echo "--- current API version ---"
docker exec "$CID" sh -lc 'grep API_VERSION /app/server.js || true'

echo "--- node/npm ---"
docker exec "$CID" sh -lc 'node -v; npm -v || true'

echo "--- DATABASE_URL (masked) ---"
docker exec "$CID" sh -lc 'printenv DATABASE_URL | sed -E "s/:[^:@]+@/:****@/"'
