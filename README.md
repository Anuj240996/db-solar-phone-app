# DB Solar — Phone App API

Node.js/Express API for the DB Solar mobile app (Flutter). Deploy on Easypanel as **phone-app** on port **8080**.

**GitHub:** https://github.com/Anuj240996/db-solar-phone-app

## Easypanel setup

1. Connect this repo in Easypanel → **phone-app** service.
2. **Branch:** `main` — Dockerfile at repo root (no subdirectory).
3. **Port:** `8080`
4. **Environment** (see `.env.example`):
   - `DATABASE_URL` — `postgresql://USER:PASS@db_solar_database:5432/db_solar_v2`
   - `JWT_SECRET` — must match tokens issued to the mobile app
   - `PORT=8080`, `NODE_ENV=production`
5. Enable **auto-deploy on push** to update the API when you push to `main`.

## Health check

```bash
curl http://YOUR_HOST:8080/api/health
```

Expect `apiVersion` **1.2.1**+ and `"services": true`.

## Local development

```bash
cp .env.example .env
npm ci
npm run dev
```

Point `.env` at your database (VPS: port `2700` externally, or local Postgres).
