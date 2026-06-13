-- ============================================================
-- Migration 033 — Create user_permission_overrides table
-- Run this if migration 031 did not create this table.
-- Safe to re-run — uses IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module          VARCHAR(30) NOT NULL,
  permission_key  VARCHAR(20) NOT NULL,
  value           BOOLEAN NOT NULL,
  set_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, module, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_user
  ON user_permission_overrides(user_id);

COMMENT ON TABLE user_permission_overrides IS
  'Per-user exceptions to their role default permissions.';
