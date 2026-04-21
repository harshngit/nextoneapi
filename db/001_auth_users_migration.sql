-- ============================================================
-- Next One Realty CRM — Database Migration
-- Tables: users, refresh_tokens, password_reset_tokens
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users Table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100) NOT NULL,
  email                VARCHAR(255) UNIQUE NOT NULL,
  password_hash        TEXT NOT NULL,
  phone_number         VARCHAR(20),
  role                 VARCHAR(30) NOT NULL CHECK (role IN (
                         'super_admin', 'superadmin', 'admin', 'sales_manager',
                         'sales_executive', 'external_caller'
                       )),
  language_preferences TEXT[] DEFAULT '{"en"}',
  regions              TEXT[] DEFAULT '{}',
  manager_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active            BOOLEAN DEFAULT true,
  last_login           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_manager   ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- ─── Refresh Tokens Table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ─── Password Reset Tokens Table ─────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
