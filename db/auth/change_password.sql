-- ============================================================
-- AUTH: Change Password
-- ============================================================

-- Find valid reset token
SELECT * FROM password_reset_tokens
WHERE token = $1
  AND expires_at > NOW()
  AND used = false;

-- Update user's password
UPDATE users
SET password_hash = $1, updated_at = NOW()
WHERE id = $2;

-- Mark token as used
UPDATE password_reset_tokens
SET used = true
WHERE id = $1;
