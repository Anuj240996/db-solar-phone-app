#!/bin/bash
CID=$(docker ps -q -f name=db_solar_database | head -1)
echo "CID=$CID"
docker exec "$CID" psql -U postgres -d db_solar_v2 -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%release%' OR table_name ILIKE '%agreem%' OR table_name ILIKE '%pdf%' OR table_name ILIKE '%document%' OR table_name ILIKE '%file%') ORDER BY 1;"
docker exec "$CID" psql -U postgres -d db_solar_v2 -c "\dt public.*" | head -200
