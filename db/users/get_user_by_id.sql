-- ============================================================
-- USERS: Get user by ID
-- ============================================================
SELECT
  id, email, first_name, last_name, phone_number, role,
  is_active, last_login,
  created_at, updated_at
FROM users
WHERE id = $1;
