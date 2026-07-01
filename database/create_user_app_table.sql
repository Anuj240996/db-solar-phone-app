-- Migration: create user_app table for app-registered users
-- Run with: node run_create_user_app_migration.js

CREATE TABLE IF NOT EXISTS user_app (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  address TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP WITH TIME ZONE
);

-- Migration: create user_app table for app-registered users
-- Run with psql -f create_user_app_table.sql or using your migration runner

-- Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_app (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  address TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP WITH TIME ZONE
);

-- Optional index on email for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_app_email ON user_app (email);

