-- ============================================================
-- USERS: Update user profile
-- ============================================================

-- Update basic profile fields
UPDATE users
SET
  first_name            = COALESCE($1, first_name),
  last_name             = COALESCE($2, last_name),
  phone_number          = COALESCE($3, phone_number),
  updated_at            = NOW()
WHERE id = $4
RETURNING
  id, email, first_name, last_name, phone_number, role,
  is_active, created_at, updated_at;
