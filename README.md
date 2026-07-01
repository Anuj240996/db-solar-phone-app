# DB Solar Backend API

Node.js + Express + PostgreSQL backend for DB Solar App.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Setup PostgreSQL database:**
   ```bash
   createdb db_solar
   ```

4. **Run migrations:**
   ```bash
   npm run migrate
   ```

5. **Seed database (optional):**
   ```bash
   npm run seed
   ```

6. **Start server:**
   ```bash
   npm start
   # or for development
   npm run dev
   ```

## Environment Variables

See `.env.example` for required environment variables.

## Database Schema

See `database/schema.sql` for complete database structure.

## API Documentation

See `API_DOCUMENTATION.md` for complete API reference.

## Project Structure

```
backend/
├── server.js           # Main server file
├── routes/              # API routes
│   ├── auth.js
│   ├── plants.js
│   ├── progress.js
│   ├── complaints.js
│   ├── faqs.js
│   ├── quotations.js
│   ├── support.js
│   └── users.js
├── middleware/          # Custom middleware
│   └── auth.js
├── database/            # Database files
│   ├── db.js
│   ├── schema.sql
│   ├── migrate.js
│   └── seed.js
└── uploads/             # File uploads directory
    └── complaints/
```

## Admin Access

Default admin credentials (after seeding):
- Email: `admin@dbsolar.com`
- Password: `admin123`

**Note:** Change the admin password in production!

