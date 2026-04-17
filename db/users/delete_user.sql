-- ============================================================
-- USERS: Soft delete user (set is_active = false)
-- ============================================================

-- Check user exists
SELECT id FROM users WHERE id = $1;

-- Soft delete
UPDATE users
SET is_active = false, updated_at = NOW()
WHERE id = $1;

-- Hard delete (use with caution)
-- DELETE FROM users WHERE id = $1;
