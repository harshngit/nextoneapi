-- ============================================================
-- AUTH: Register new user
-- ============================================================

-- Check if email or phone exists
SELECT id FROM users
WHERE email = $1 OR phone_number = $2;

-- Insert new user
INSERT INTO users (
  id, email, first_name, last_name, phone_number, password_hash, role
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING
  id, email, first_name, last_name, phone_number,
  role, is_active, created_at;
