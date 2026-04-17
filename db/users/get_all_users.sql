-- ============================================================
-- USERS: Get all users with pagination, filtering, search
-- ============================================================

-- Count total (adjust WHERE clauses as needed)
SELECT COUNT(*) FROM users
WHERE is_active = true;                  -- base query

-- Count with role filter
SELECT COUNT(*) FROM users
WHERE is_active = true AND role = $1;

-- Count with search
SELECT COUNT(*) FROM users
WHERE is_active = true
  AND (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1);

-- Fetch paginated users
SELECT
  id, email, first_name, last_name, phone_number, role,
  language_preferences, regions, is_active, last_login,
  created_at, updated_at
FROM users
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;
