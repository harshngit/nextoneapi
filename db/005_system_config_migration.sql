-- ============================================================
-- Next One Realty CRM — Migration
-- Tables: role_permissions, lead_sources,
--         system_settings, audit_logs
-- ============================================================

-- ─── Role Permissions Table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  role         VARCHAR(30) PRIMARY KEY CHECK (role IN ('admin','sales_manager','sales_executive','external_caller')),
  display_name VARCHAR(100),
  permissions  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default permissions
INSERT INTO role_permissions (role, display_name, permissions) VALUES
('admin', 'Admin', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":true},
  "projects":    {"view":true,"create":true,"edit":true,"delete":true},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":true},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":true},
  "users":       {"view":true,"create":true,"edit":true,"delete":true},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('sales_manager', 'Sales Manager', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":true},
  "users":       {"view":true,"create":false,"edit":false,"delete":false},
  "reports":     {"view":true,"create":false,"edit":false,"delete":false}
}'),
('sales_executive', 'Sales Executive', '{
  "leads":       {"view":true,"create":true,"edit":true,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":true,"create":true,"edit":true,"delete":false},
  "tasks":       {"view":true,"create":true,"edit":true,"delete":false},
  "users":       {"view":false,"create":false,"edit":false,"delete":false},
  "reports":     {"view":false,"create":false,"edit":false,"delete":false}
}'),
('external_caller', 'External Caller', '{
  "leads":       {"view":true,"create":true,"edit":false,"delete":false},
  "projects":    {"view":true,"create":false,"edit":false,"delete":false},
  "site_visits": {"view":false,"create":false,"edit":false,"delete":false},
  "tasks":       {"view":true,"create":false,"edit":false,"delete":false},
  "users":       {"view":false,"create":false,"edit":false,"delete":false},
  "reports":     {"view":false,"create":false,"edit":false,"delete":false}
}')
ON CONFLICT (role) DO NOTHING;

-- ─── Lead Sources Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_sources (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(100) UNIQUE NOT NULL,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default lead sources
INSERT INTO lead_sources (name) VALUES
  ('Facebook'), ('Instagram'), ('99acres'),
  ('MagicBricks'), ('Housing.com'), ('Walk-in'),
  ('Referral'), ('Google Ads'), ('IVR / Call')
ON CONFLICT (name) DO NOTHING;

-- ─── System Settings Table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name             VARCHAR(255) DEFAULT 'Next One Realty',
  timezone                 VARCHAR(100) DEFAULT 'Asia/Kolkata',
  default_language         VARCHAR(10)  DEFAULT 'en',
  task_reminder_minutes    INTEGER      DEFAULT 30,
  visit_reminder_hours     INTEGER      DEFAULT 24,
  max_leads_per_executive  INTEGER      DEFAULT 100,
  updated_at               TIMESTAMPTZ  DEFAULT NOW()
);

-- Seed one default row
INSERT INTO system_settings (company_name) VALUES ('Next One Realty')
ON CONFLICT DO NOTHING;

-- ─── Audit Logs Table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action         VARCHAR(50) NOT NULL CHECK (action IN (
                   'role_change','permission_update','user_created',
                   'user_deactivated','config_update','lead_source_change'
                 )),
  description    TEXT NOT NULL,
  performed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action       ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_by ON audit_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at   ON audit_logs(created_at);
