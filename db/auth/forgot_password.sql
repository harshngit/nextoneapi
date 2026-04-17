-- ============================================================
-- AUTH: Forgot Password
-- ============================================================

-- Find user by email
SELECT id FROM users
WHERE email = $1 AND is_active = true;

-- Upsert reset token (one token per user)
INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id)
DO UPDATE SET
  token = EXCLUDED.token,
  expires_at = EXCLUDED.expires_at,
  used = false;
