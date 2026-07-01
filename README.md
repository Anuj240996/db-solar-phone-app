# DB Solar — Phone App API

Node.js/Express API for the DB Solar mobile app (Flutter). Deploy on Easypanel as **phone-app** on port **8080**.

## Easypanel setup

1. Create a new service from **GitHub** → this repository (`db-solar-phone-app`).
2. **Build:** Dockerfile at repo root (no subdirectory).
3. **Port:** `8080`
4. **Environment variables** (see `.env.example`):
   - `DATABASE_URL` — use internal host `db_solar_database:5432` and database `db_solar_v2`
   - `JWT_SECRET` — same value the app expects for auth tokens
   - `PORT=8080`
   - `NODE_ENV=production`
5. Enable **auto-deploy** on push to `main` when you want updates to go live automatically.

## Health check

```bash
curl http://YOUR_HOST:8080/api/health
```

Expect `apiVersion` **1.2.1** or newer and `"services": true`.

## Local development

Copy `.env.example` to `.env`, point `DATABASE_URL` at your DB, then:

```bash
npm ci
npm run dev
```
