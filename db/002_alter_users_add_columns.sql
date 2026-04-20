-- ============================================================
-- Next One Realty CRM — Alter Migration
-- Adds missing columns to existing users table
-- Run this instead of 001_auth_users_migration.sql
-- ============================================================

-- Add manager_id column if it doesn't exist
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add any other columns that may be missing
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS language_preferences VARCHAR(10) DEFAULT 'en';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS regions JSONB DEFAULT '[]';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add indexes
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
