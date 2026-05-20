-- ============================================================
-- Migration 020 — New roles + employee address & emergency contact
-- ============================================================

-- ─── 1. Add new values to the user_role ENUM type ────────────────────────────
-- ALTER TYPE ... ADD VALUE is safe — it only adds, never removes.
-- IF NOT EXISTS prevents errors on re-run.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'associate';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'associate_partner';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'partner';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'team_leader';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'cluster';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'cluster_head';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'digital_marketing';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr_admin';

-- ─── 2. Expand CHECK constraint on role_permissions.role ─────────────────────
-- role_permissions uses a VARCHAR(30) PRIMARY KEY with inline CHECK.
-- Inline CHECK on a PRIMARY KEY has no name — must recreate the table.

ALTER TABLE role_permissions RENAME TO role_permissions_old;

CREATE TABLE role_permissions (
  role         VARCHAR(30) PRIMARY KEY CHECK (role IN (
                 'admin', 'sales_manager', 'sales_executive', 'external_caller',
                 'associate', 'associate_partner', 'partner',
                 'team_leader', 'cluster', 'cluster_head',
                 'digital_marketing', 'hr_admin'
               )),
  display_name VARCHAR(100),
  permissions  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO role_permissions SELECT * FROM role_permissions_old;
DROP TABLE role_permissions_old;

-- ─── 3. Add employee address and emergency contact to users ───────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS emergency_contact_number VARCHAR(20);

COMMENT ON COLUMN users.address                    IS 'Employee residential address';
COMMENT ON COLUMN users.emergency_contact_number   IS 'Employee emergency contact phone number';

-- ─── 4. Seed new roles into role_permissions ─────────────────────────────────
INSERT INTO role_permissions (role, display_name, permissions) VALUES
('associate', 'Associate', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":false},
  "users":       {"view":false,"create":false,"edit":false,"delete":false},
  "reports":     {"view":false,"create":false,"edit":false,"delete":false}
}'),
('associate_partner', 'Associate Partner', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":false},
  "users":       {"view":true,"create":false,"edit":false,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('partner', 'Partner', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":true},
  "users":       {"view":true,"create":false,"edit":false,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('team_leader', 'Team Leader', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":true},
  "users":       {"view":true,"create":false,"edit":false,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('cluster', 'Cluster', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":true},
  "users":       {"view":true,"create":false,"edit":false,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('cluster_head', 'Cluster Head', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":true,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":true},
  "users":       {"view":true,"create":false,"edit":false,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('digital_marketing', 'Digital Marketing', '{
  "leads":       {"view":true,"create":true,"edit":false,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":false,"create":false,"edit":false,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":false},
  "users":       {"view":false,"create":false,"edit":false,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('hr_admin', 'HR Admin', '{
  "leads":       {"view":false,"create":false,"edit":false,"delete":false},
  "projects":    {"view":false,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":false,"create":false,"edit":false,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":true},
  "users":       {"view":true,"create":true,"edit":true,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}')
ON CONFLICT (role) DO NOTHING;