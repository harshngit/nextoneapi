-- ============================================================
-- Next One Realty CRM — Migration 022
-- FCM Push Notification Support
-- ============================================================

-- ─── 1. Add fcm_token column to users ────────────────────────
--   Stores the LATEST FCM token for each user (single-device assumption).
--   For multi-device support, use the device_tokens table below instead.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fcm_token TEXT DEFAULT NULL;

-- ─── 2. device_tokens — multi-device support (optional) ──────
--   Each row = one device belonging to one user.
--   The mobile app should call POST /api/v1/notifications/fcm-token
--   after login and after the OS refreshes the token.
CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token  TEXT        NOT NULL,
  platform   VARCHAR(10) DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);

COMMENT ON TABLE device_tokens IS
  'Stores FCM device tokens per user. One user can have multiple devices.';