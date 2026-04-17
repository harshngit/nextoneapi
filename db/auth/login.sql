-- ============================================================
-- AUTH: Login
-- ============================================================

-- Login by email
SELECT * FROM users
WHERE email = $1 AND is_active = true;

-- Login by phone number
SELECT * FROM users
WHERE phone_number = $1 AND is_active = true;

-- Update last login timestamp
UPDATE users
SET last_login = NOW()
WHERE id = $1;
