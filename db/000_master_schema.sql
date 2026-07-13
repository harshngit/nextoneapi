-- ============================================================
-- Next One Realty CRM — MASTER SCHEMA
-- Single file: run this on a fresh database to get everything.
-- Includes all migrations 001–043 + all role permissions seeded.
-- Safe to run on an empty DB. Do NOT run on an existing DB
-- that already has tables — use the individual migration files
-- instead to avoid conflicts.
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENUM: user_role (all roles including new ones from 020) ──
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'super_admin',
    'superadmin',
    'admin',
    'sales_manager',
    'sales_executive',
    'external_caller',
    'associate',
    'associate_partner',
    'partner',
    'team_leader',
    'cluster',
    'cluster_head',
    'digital_marketing',
    'hr_admin'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name                VARCHAR(100) NOT NULL,
  last_name                 VARCHAR(100) NOT NULL,
  email                     VARCHAR(255) UNIQUE NOT NULL,
  password_hash             TEXT        NOT NULL,
  phone_number              VARCHAR(20),
  role                      VARCHAR(30) NOT NULL CHECK (role IN (
                              'super_admin','superadmin','admin',
                              'sales_manager','sales_executive','external_caller',
                              'associate','associate_partner','partner',
                              'team_leader','cluster','cluster_head',
                              'digital_marketing','hr_admin'
                            )),
  manager_id                UUID        REFERENCES users(id) ON DELETE SET NULL,
  is_active                 BOOLEAN     DEFAULT true,
  last_login                TIMESTAMPTZ,
  address                   TEXT,
  emergency_contact_number  VARCHAR(20),
  fcm_token                 TEXT        DEFAULT NULL,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_manager    ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active  ON users(is_active);

COMMENT ON COLUMN users.address                   IS 'Employee residential address';
COMMENT ON COLUMN users.emergency_contact_number  IS 'Employee emergency contact phone number';

-- ─── Auto-update updated_at trigger ──────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABLE: refresh_tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ============================================================
-- TABLE: password_reset_tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id    UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: device_tokens  (FCM multi-device support)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token  TEXT        NOT NULL,
  platform   VARCHAR(10) DEFAULT 'android' CHECK (platform IN ('android','ios','web')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
COMMENT ON TABLE device_tokens IS 'Stores FCM device tokens per user. One user can have multiple devices.';

-- ============================================================
-- TABLE: role_permissions  (all 12 configurable roles)
-- ============================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  role         VARCHAR(30) PRIMARY KEY CHECK (role IN (
                 'admin','sales_manager','sales_executive','external_caller',
                 'associate','associate_partner','partner',
                 'team_leader','cluster','cluster_head',
                 'digital_marketing','hr_admin'
               )),
  display_name VARCHAR(100),
  permissions  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Seed all role permissions ────────────────────────────────
INSERT INTO role_permissions (role, display_name, permissions) VALUES

('admin', 'Admin', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "salary":         {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "team":           {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "users":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "targets":        {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "phone_requests": {"view":true, "create":false,"edit":true, "delete":false,"approve":true, "export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('sales_manager', 'Sales Manager', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "attendance":     {"view":true, "create":false,"edit":false,"delete":false,"approve":true, "export":true},
  "salary":         {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('sales_executive', 'Sales Executive', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "closures":       {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('external_caller', 'External Caller', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "revisits":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "closures":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('associate', 'Associate', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "closures":       {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('associate_partner', 'Associate Partner', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('partner', 'Partner', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('team_leader', 'Team Leader', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":true},
  "salary":         {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('cluster', 'Cluster', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":true},
  "salary":         {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('cluster_head', 'Cluster Head', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":true, "delete":false,"approve":false,"export":true},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":true},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "phone_requests": {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('digital_marketing', 'Digital Marketing', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "revisits":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "closures":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "targets":        {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('hr_admin', 'HR Admin', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "projects":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "revisits":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "closures":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "salary":         {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "targets":        {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "phone_requests": {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}')

ON CONFLICT (role) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  permissions  = EXCLUDED.permissions,
  updated_at   = NOW();

-- ============================================================
-- TABLE: user_permission_overrides
-- ============================================================
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module          VARCHAR(30) NOT NULL,
  permission_key  VARCHAR(20) NOT NULL,
  value           BOOLEAN     NOT NULL,
  set_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, module, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_user ON user_permission_overrides(user_id);
COMMENT ON TABLE user_permission_overrides IS 'Per-user exceptions to their role default permissions.';

-- ============================================================
-- TABLE: system_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name             VARCHAR(255) DEFAULT 'Next One Realty',
  timezone                 VARCHAR(100) DEFAULT 'Asia/Kolkata',
  default_language         VARCHAR(10)  DEFAULT 'en',
  task_reminder_minutes    INTEGER      DEFAULT 30,
  visit_reminder_hours     INTEGER      DEFAULT 24,
  max_leads_per_executive  INTEGER      DEFAULT 100,
  office_checkin_start     VARCHAR(5)   DEFAULT '09:00',
  office_checkin_late      VARCHAR(5)   DEFAULT '09:30',
  office_checkout_time     VARCHAR(5)   DEFAULT '18:00',
  updated_at               TIMESTAMPTZ  DEFAULT NOW()
);

INSERT INTO system_settings (company_name) VALUES ('Next One Realty')
ON CONFLICT DO NOTHING;

-- ============================================================
-- TABLE: lead_sources
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_sources (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(100) UNIQUE NOT NULL,
  is_active  BOOLEAN     DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO lead_sources (name) VALUES
  ('Facebook'),('Instagram'),('99acres'),
  ('MagicBricks'),('Housing.com'),('Walk-in'),
  ('Referral'),('Google Ads'),('IVR / Call')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- TABLE: lead_statuses
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_statuses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        VARCHAR(50)  UNIQUE NOT NULL,
  label      VARCHAR(100) NOT NULL,
  color      VARCHAR(20)  DEFAULT '#6b7280',
  sort_order INTEGER      DEFAULT 0,
  is_active  BOOLEAN      DEFAULT true,
  is_system  BOOLEAN      DEFAULT false,
  created_at TIMESTAMPTZ  DEFAULT NOW(),
  updated_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_statuses_sort ON lead_statuses(sort_order ASC);

INSERT INTO lead_statuses (key, label, color, sort_order, is_system) VALUES
  ('new',                  'New',                   '#6b7280', 1, true),
  ('contacted',            'Contacted',             '#3b82f6', 2, true),
  ('interested',           'Interested',            '#8b5cf6', 3, true),
  ('follow_up',            'Follow Up',             '#f59e0b', 4, true),
  ('site_visit_scheduled', 'Site Visit Scheduled',  '#06b6d4', 5, true),
  ('site_visit_done',      'Site Visit Done',       '#10b981', 6, true),
  ('negotiation',          'Negotiation',           '#f97316', 7, true),
  ('booked',               'Booked',                '#22c55e', 8, true),
  ('lost',                 'Lost',                  '#ef4444', 9, true)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TABLE: audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  action         VARCHAR(50) NOT NULL CHECK (action IN (
                   'role_change','permission_update','user_created',
                   'user_deactivated','config_update','lead_source_change'
                 )),
  description    TEXT        NOT NULL,
  performed_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  metadata       JSONB       DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action       ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_by ON audit_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at   ON audit_logs(created_at);

-- ============================================================
-- TABLE: projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(255) NOT NULL,
  developer        VARCHAR(255),
  city             VARCHAR(100) NOT NULL,
  locality         VARCHAR(100),
  address          TEXT,
  configurations   JSONB       DEFAULT '[]',
  price_range      VARCHAR(100),
  total_units      INTEGER,
  possession_date  DATE,
  rera_number      VARCHAR(100),
  amenities        JSONB       DEFAULT '[]',
  status           VARCHAR(20) DEFAULT 'active' CHECK (status IN (
                     'active','inactive','upcoming','completed',
                     'under_construction','pre_launch','nearby_possession','ready_to_move'
                   )),
  brochure_url     TEXT,
  description      TEXT,
  video_url        TEXT,
  payment_plan     TEXT,
  home_loan_info   TEXT,
  created_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_city   ON projects(city);

-- ============================================================
-- TABLE: project_documents
-- ============================================================
CREATE TABLE IF NOT EXISTS project_documents (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('unit_plan','creative','payment_plan','video','photo','developer_logo')),
  file_name     VARCHAR(255) NOT NULL,
  file_path     TEXT        NOT NULL,
  file_size     INTEGER     NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  uploaded_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_documents_project     ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_type        ON project_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_project_documents_uploaded_at ON project_documents(uploaded_at);

-- ============================================================
-- TABLE: leads  (includes all columns through migration 043)
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      VARCHAR(255) NOT NULL,
  phone                     VARCHAR(20)  NOT NULL,
  alternate_phone_number    VARCHAR(20),
  email                     VARCHAR(255),
  source                    VARCHAR(100),
  status                    VARCHAR(50)  DEFAULT 'new',
  -- No CHECK constraint: valid statuses are governed by the lead_statuses
  -- table + app-level validation (isValidLeadStatus in leadController.js),
  -- so admin-defined custom statuses (migration 048) can be saved here too.
  budget                    VARCHAR(100),
  location_preference       VARCHAR(255),
  configuration             VARCHAR(255),
  project_id                UUID        REFERENCES projects(id) ON DELETE SET NULL,
  project_name_text         TEXT,
  assigned_to               UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_by                UUID        REFERENCES users(id) ON DELETE SET NULL,
  is_archived               BOOLEAN     DEFAULT false,
  is_converted              BOOLEAN     DEFAULT false,
  converted_at              TIMESTAMPTZ DEFAULT NULL,
  callback_time             TIMESTAMPTZ,
  next_followup_time        TIMESTAMPTZ,
  whatsapp_welcome_sent     BOOLEAN     DEFAULT false,
  whatsapp_interested_sent  BOOLEAN     DEFAULT false,
  whatsapp_negotiation_sent BOOLEAN     DEFAULT false,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status             ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned           ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_project            ON leads(project_id);
CREATE INDEX IF NOT EXISTS idx_leads_is_archived        ON leads(is_archived);
CREATE INDEX IF NOT EXISTS idx_leads_is_converted       ON leads(is_converted);
CREATE INDEX IF NOT EXISTS idx_leads_created_at         ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_callback_time      ON leads(callback_time);
CREATE INDEX IF NOT EXISTS idx_leads_next_followup_time ON leads(next_followup_time);

COMMENT ON COLUMN leads.project_name_text  IS 'Free-text project name when no matching project record exists';
COMMENT ON COLUMN leads.callback_time      IS 'Scheduled time to call the lead back';
COMMENT ON COLUMN leads.next_followup_time IS 'Scheduled time for the next follow-up';

-- ============================================================
-- TABLE: lead_activities
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_activities (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL CHECK (type IN ('note','call','email','whatsapp','meeting','status_change','assignment')),
  note         TEXT        NOT NULL,
  performed_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_type ON lead_activities(type);

-- ============================================================
-- TABLE: lead_reassignment_history
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_reassignment_history (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  to_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  reason       TEXT,
  performed_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_reassignment_lead       ON lead_reassignment_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_reassignment_from_user  ON lead_reassignment_history(from_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_reassignment_to_user    ON lead_reassignment_history(to_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_reassignment_created_at ON lead_reassignment_history(created_at);

-- ============================================================
-- TABLE: phone_reveal_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS phone_reveal_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID        NOT NULL REFERENCES leads(id)  ON DELETE CASCADE,
  requested_by UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  reason       TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  reviewed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  review_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prr_requested_by_status ON phone_reveal_requests(requested_by, status);
CREATE INDEX IF NOT EXISTS idx_prr_status              ON phone_reveal_requests(status);
CREATE INDEX IF NOT EXISTS idx_prr_lead_id             ON phone_reveal_requests(lead_id);

CREATE OR REPLACE FUNCTION update_phone_reveal_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_phone_reveal_updated_at ON phone_reveal_requests;
CREATE TRIGGER trg_phone_reveal_updated_at
  BEFORE UPDATE ON phone_reveal_requests
  FOR EACH ROW EXECUTE FUNCTION update_phone_reveal_updated_at();

-- ============================================================
-- TABLE: call_recordings
-- ============================================================
CREATE TABLE IF NOT EXISTS call_recordings (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  phone_number VARCHAR(20),
  name        VARCHAR(255),
  file_size   BIGINT,
  uploaded_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_lead ON call_recordings(lead_id);

-- ============================================================
-- TABLE: payment_proofs  (migration 044 — booking receipts / screenshots)
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_proofs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  name        VARCHAR(255),
  amount      VARCHAR(100),
  file_size   BIGINT,
  uploaded_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_lead ON payment_proofs(lead_id);

-- ============================================================
-- TABLE: lead_photos  (migration 045 — front-page form photo, separate from payment proof)
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_photos (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  name        VARCHAR(255),
  file_size   BIGINT,
  uploaded_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_photos_lead ON lead_photos(lead_id);

-- ============================================================
-- TABLE: site_visits  (includes closing_manager, closing_person, whatsapp, reminder columns)
-- ============================================================
CREATE TABLE IF NOT EXISTS site_visits (
  id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id                     UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id                  UUID        REFERENCES projects(id) ON DELETE CASCADE,
  project_name_text           TEXT,
  visit_date                  DATE        NOT NULL,
  visit_time                  TIME        NOT NULL,
  assigned_to                 UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_by                  UUID        REFERENCES users(id) ON DELETE SET NULL,
  status                      VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN (
                                'scheduled','done','cancelled','rescheduled','no_show'
                              )),
  transport_arranged          BOOLEAN     DEFAULT false,
  notes                       TEXT,
  closing_manager             UUID        REFERENCES users(id) ON DELETE SET NULL,
  closing_person              VARCHAR(255),
  visit_reminder_sent         BOOLEAN     DEFAULT false,
  whatsapp_confirmation_sent  BOOLEAN     DEFAULT false,
  whatsapp_1day_sent          BOOLEAN     DEFAULT false,
  whatsapp_today_sent         BOOLEAN     DEFAULT false,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_visits_lead          ON site_visits(lead_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_assigned      ON site_visits(assigned_to);
CREATE INDEX IF NOT EXISTS idx_site_visits_status        ON site_visits(status);
CREATE INDEX IF NOT EXISTS idx_site_visits_visit_date    ON site_visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_site_visits_date_status   ON site_visits(visit_date, status);
CREATE INDEX IF NOT EXISTS idx_site_visits_reminder_cron ON site_visits(visit_date, status, visit_reminder_sent);

COMMENT ON COLUMN site_visits.project_name_text IS 'Free-text project name when no matching project record exists';

-- ============================================================
-- TABLE: site_visit_feedback
-- ============================================================
CREATE TABLE IF NOT EXISTS site_visit_feedback (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_visit_id   UUID        UNIQUE NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  rating          SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  client_reaction VARCHAR(30) CHECK (client_reaction IN ('very_positive','positive','neutral','negative','not_interested')),
  interested_in   VARCHAR(255),
  next_step       VARCHAR(30) CHECK (next_step IN ('negotiation','follow_up','send_proposal','booked','lost','site_revisit')),
  remarks         TEXT,
  submitted_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: site_revisits
-- ============================================================
CREATE TABLE IF NOT EXISTS site_revisits (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_visit_id         UUID        NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  lead_id                   UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id                UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  visit_date                DATE        NOT NULL,
  visit_time                VARCHAR(10) NOT NULL,
  assigned_to               UUID        REFERENCES users(id) ON DELETE SET NULL,
  status                    VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN (
                              'scheduled','done','cancelled','rescheduled','no_show'
                            )),
  transport_arranged        BOOLEAN     DEFAULT false,
  reason                    TEXT,
  notes                     TEXT,
  created_by                UUID        REFERENCES users(id) ON DELETE SET NULL,
  closing_manager           UUID        REFERENCES users(id) ON DELETE SET NULL,
  closing_person            VARCHAR(255),
  visit_reminder_sent       BOOLEAN     DEFAULT false,
  whatsapp_confirmation_sent BOOLEAN    DEFAULT false,
  whatsapp_1day_sent        BOOLEAN     DEFAULT false,
  whatsapp_2hour_sent       BOOLEAN     DEFAULT false,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_revisits_original     ON site_revisits(original_visit_id);
CREATE INDEX IF NOT EXISTS idx_site_revisits_lead         ON site_revisits(lead_id);
CREATE INDEX IF NOT EXISTS idx_site_revisits_date         ON site_revisits(visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_site_revisits_reminder_cron ON site_revisits(visit_date, status, visit_reminder_sent);
CREATE INDEX IF NOT EXISTS idx_site_revisits_wa_cron      ON site_revisits(visit_date, status, whatsapp_1day_sent, whatsapp_2hour_sent);

COMMENT ON TABLE site_revisits         IS 'Follow-up site visits linked to an original visit';

-- ============================================================
-- TABLE: site_revisit_feedback
-- ============================================================
CREATE TABLE IF NOT EXISTS site_revisit_feedback (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  revisit_id       UUID        NOT NULL UNIQUE REFERENCES site_revisits(id) ON DELETE CASCADE,
  rating           INTEGER     CHECK (rating BETWEEN 1 AND 5),
  client_reaction  VARCHAR(30) NOT NULL CHECK (client_reaction IN ('very_positive','positive','neutral','negative','not_interested')),
  interested_in    TEXT,
  next_step        VARCHAR(30) NOT NULL CHECK (next_step IN ('negotiation','follow_up','send_proposal','booked','lost','another_revisit')),
  remarks          TEXT,
  submitted_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE site_revisit_feedback IS 'Feedback submitted after a revisit is completed';

-- ============================================================
-- TABLE: lead_closures
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_closures (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID        NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,
  site_visit_id         UUID        REFERENCES site_visits(id) ON DELETE SET NULL,
  booking_date          DATE        NOT NULL,
  unit_number           VARCHAR(100),
  tower_block           VARCHAR(100),
  floor_number          INTEGER,
  unit_type             VARCHAR(50),
  carpet_area_sqft      NUMERIC(10,2),
  super_area_sqft       NUMERIC(10,2),
  agreed_price          NUMERIC(15,2),
  booking_amount        NUMERIC(15,2),
  payment_plan          VARCHAR(100),
  loan_required         BOOLEAN     DEFAULT false,
  loan_bank             VARCHAR(200),
  commission_amount     NUMERIC(15,2),
  commission_percent    NUMERIC(5,2),
  commission_paid       BOOLEAN     DEFAULT false,
  commission_paid_date  DATE,
  closed_by             UUID        REFERENCES users(id) ON DELETE SET NULL,
  closed_by_manager     UUID[],
  closure_notes         TEXT,
  status                VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','on_hold')),
  whatsapp_confirmed_sent BOOLEAN   DEFAULT false,
  whatsapp_cancelled_sent BOOLEAN   DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_closures_lead    ON lead_closures(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_closures_project ON lead_closures(project_id);
CREATE INDEX IF NOT EXISTS idx_lead_closures_date    ON lead_closures(booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_lead_closures_closed  ON lead_closures(closed_by);

COMMENT ON TABLE  lead_closures                   IS 'Booking/closure records when a lead converts to a customer';
COMMENT ON COLUMN lead_closures.agreed_price      IS 'Final negotiated sale price in INR';
COMMENT ON COLUMN lead_closures.booking_amount    IS 'Initial token/booking amount paid by client';
COMMENT ON COLUMN lead_closures.closed_by_manager IS 'Array of manager UUIDs who supervised this closure';

-- ============================================================
-- TABLE: closure_documents  (migration 049 — cost sheet, payment proof)
-- ============================================================
CREATE TABLE IF NOT EXISTS closure_documents (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  closure_id    UUID        NOT NULL REFERENCES lead_closures(id) ON DELETE CASCADE,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('cost_sheet','payment_proof')),
  url           TEXT        NOT NULL,
  name          VARCHAR(255),
  file_size     BIGINT,
  mime_type     VARCHAR(100),
  uploaded_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_closure_documents_closure ON closure_documents(closure_id);

-- ============================================================
-- TABLE: tasks  (follow-ups)
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                    VARCHAR(255) NOT NULL,
  lead_id                  UUID        REFERENCES leads(id) ON DELETE CASCADE,
  due_date                 TIMESTAMPTZ NOT NULL,
  assigned_to              UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_by               UUID        REFERENCES users(id) ON DELETE SET NULL,
  priority                 VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  notes                    TEXT,
  is_completed             BOOLEAN     DEFAULT false,
  completed_at             TIMESTAMPTZ,
  follow_up_reminder_sent  BOOLEAN     DEFAULT false,
  follow_up_overdue_sent   BOOLEAN     DEFAULT false,
  whatsapp_followup_sent   BOOLEAN     DEFAULT false,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to   ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_lead_id       ON tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date      ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_is_completed  ON tasks(is_completed);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder_cron ON tasks(due_date, is_completed, follow_up_reminder_sent);

COMMENT ON COLUMN tasks.follow_up_reminder_sent IS 'True once the 30-min-before reminder push has been sent';
COMMENT ON COLUMN tasks.follow_up_overdue_sent  IS 'True once the overdue reminder push has been sent';

-- ============================================================
-- TABLE: notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           VARCHAR(50) NOT NULL CHECK (type IN (
                   'lead_assigned','lead_status_changed','lead_new',
                   'follow_up_created','follow_up_due','follow_up_overdue','follow_up_completed',
                   'task_created','task_reminder','task_completed',
                   'visit_scheduled','visit_reminder','visit_done','visit_cancelled','visit_rescheduled',
                   'booking_new','payment_received','commission_credited',
                   'project_new','project_updated',
                   'attendance_checkin','attendance_checkout','attendance_pending',
                   'attendance_manual','attendance_approved','attendance_reminder',
                   'general'
                 )),
  title          VARCHAR(255) NOT NULL,
  message        TEXT        NOT NULL,
  is_read        BOOLEAN     DEFAULT false,
  reference_id   UUID,
  reference_type VARCHAR(50),
  metadata       JSONB       DEFAULT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read   ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type      ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================================
-- TABLE: attendance
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                DATE        NOT NULL DEFAULT CURRENT_DATE,
  check_in_time       TIMESTAMPTZ,
  check_out_time      TIMESTAMPTZ,
  working_hours       NUMERIC(5,2),
  status              VARCHAR(20) NOT NULL DEFAULT 'absent' CHECK (status IN ('present','absent','late','leave')),
  leave_type          VARCHAR(20) CHECK (leave_type IN ('full_day','half_day','sick','casual','unpaid','holiday') OR leave_type IS NULL),
  late_by_minutes     INTEGER,
  checkin_photo       TEXT,
  checkout_photo      TEXT,
  checkin_latitude    NUMERIC(10,7),
  checkin_longitude   NUMERIC(10,7),
  checkin_address     TEXT,
  checkout_latitude   NUMERIC(10,7),
  checkout_longitude  NUMERIC(10,7),
  checkout_address    TEXT,
  checkin_ip          VARCHAR(64),
  checkin_device      TEXT,
  checkout_ip         VARCHAR(64),
  checkout_device     TEXT,
  is_manual_entry     BOOLEAN     DEFAULT FALSE,
  manual_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  manual_reason       TEXT,
  reason              TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_attendance_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_user_id   ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date      ON attendance(date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status    ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date DESC);

CREATE OR REPLACE FUNCTION update_attendance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION update_attendance_updated_at();

-- ============================================================
-- TABLE: holidays
-- ============================================================
CREATE TABLE IF NOT EXISTS holidays (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE        NOT NULL,
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  roles       TEXT[]      NOT NULL DEFAULT '{}',
  user_ids    UUID[]      NOT NULL DEFAULT '{}',
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_holiday_has_target CHECK (
    array_length(roles, 1) > 0 OR array_length(user_ids, 1) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

CREATE OR REPLACE FUNCTION update_holidays_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_holidays_updated_at ON holidays;
CREATE TRIGGER trg_holidays_updated_at
  BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION update_holidays_updated_at();

-- ============================================================
-- TABLE: employee_salaries
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_salaries (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monthly_salary NUMERIC(12,2) NOT NULL CHECK (monthly_salary >= 0),
  effective_from DATE          NOT NULL DEFAULT CURRENT_DATE,
  set_by         UUID          REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ   DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_salaries_user_id        ON employee_salaries(user_id);
CREATE INDEX IF NOT EXISTS idx_emp_salaries_effective_from ON employee_salaries(effective_from DESC);

COMMENT ON TABLE  employee_salaries                IS 'Monthly salary records per employee, set by admin';
COMMENT ON COLUMN employee_salaries.monthly_salary IS 'Gross monthly salary in INR';
COMMENT ON COLUMN employee_salaries.effective_from IS 'Date from which this salary is active';

-- ============================================================
-- TABLE: salary_slips
-- ============================================================
CREATE TABLE IF NOT EXISTS salary_slips (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month            SMALLINT      NOT NULL CHECK (month BETWEEN 1 AND 12),
  year             SMALLINT      NOT NULL CHECK (year >= 2020),
  monthly_salary   NUMERIC(12,2) NOT NULL,
  working_days     INTEGER       NOT NULL,
  present_days     NUMERIC(5,2)  NOT NULL,
  absent_days      NUMERIC(5,2)  NOT NULL,
  leave_days       NUMERIC(5,2)  NOT NULL,
  per_day_salary   NUMERIC(12,2) NOT NULL,
  earned_salary    NUMERIC(12,2) NOT NULL,
  deductions       NUMERIC(12,2) DEFAULT 0,
  final_salary     NUMERIC(12,2) NOT NULL,
  incentive_amount NUMERIC(12,2) DEFAULT 0,
  total_payout     NUMERIC(12,2),
  generated_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   DEFAULT NOW(),
  CONSTRAINT uq_salary_slip_user_month_year UNIQUE (user_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_salary_slips_user_id    ON salary_slips(user_id);
CREATE INDEX IF NOT EXISTS idx_salary_slips_month_year ON salary_slips(year DESC, month DESC);

COMMENT ON TABLE salary_slips                    IS 'Monthly computed salary slips per employee';
COMMENT ON COLUMN salary_slips.incentive_amount  IS 'Total incentives added for this month';
COMMENT ON COLUMN salary_slips.total_payout      IS 'final_salary + incentive_amount — actual take-home';

-- ============================================================
-- TABLE: employee_incentives
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_incentives (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      SMALLINT      NOT NULL CHECK (month BETWEEN 1 AND 12),
  year       SMALLINT      NOT NULL CHECK (year >= 2020),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reason     TEXT,
  given_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ   DEFAULT NOW(),
  updated_at TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incentives_user_id    ON employee_incentives(user_id);
CREATE INDEX IF NOT EXISTS idx_incentives_month_year ON employee_incentives(year DESC, month DESC);

COMMENT ON TABLE employee_incentives          IS 'Performance-based incentive payouts per employee per month';
COMMENT ON COLUMN employee_incentives.amount  IS 'Incentive amount in INR added on top of earned salary';

-- ============================================================
-- TABLE: employee_appraisals
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_appraisals (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_salary       NUMERIC(12,2),
  to_salary         NUMERIC(12,2) NOT NULL,
  increment_amount  NUMERIC(12,2),
  increment_percent NUMERIC(6,2),
  effective_from    DATE          NOT NULL DEFAULT CURRENT_DATE,
  appraisal_note    TEXT,
  appraised_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appraisals_user_id        ON employee_appraisals(user_id);
CREATE INDEX IF NOT EXISTS idx_appraisals_effective_from ON employee_appraisals(effective_from DESC);

COMMENT ON TABLE employee_appraisals IS 'Appraisal history: salary revisions with increment details';

-- ============================================================
-- TABLE: employee_bonus
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_bonus (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  bonus_type VARCHAR(100)  NOT NULL DEFAULT 'general',
  month      SMALLINT      CHECK (month BETWEEN 1 AND 12),
  year       SMALLINT      CHECK (year >= 2020),
  reason     TEXT,
  paid       BOOLEAN       DEFAULT false,
  paid_date  DATE,
  given_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ   DEFAULT NOW(),
  updated_at TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonus_user_id ON employee_bonus(user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_year    ON employee_bonus(year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_bonus_paid    ON employee_bonus(paid);

COMMENT ON TABLE  employee_bonus            IS 'One-time bonus payouts: Diwali, annual, performance, spot award etc.';
COMMENT ON COLUMN employee_bonus.bonus_type IS 'Type: diwali | annual | performance | spot_award | joining | referral | general';
COMMENT ON COLUMN employee_bonus.paid       IS 'Whether the bonus has been disbursed to the employee';

-- ============================================================
-- TABLE: user_targets
-- ============================================================
CREATE TABLE IF NOT EXISTS user_targets (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_month      DATE        NOT NULL,
  site_visit_target INTEGER     NOT NULL DEFAULT 15 CHECK (site_visit_target >= 0),
  closure_target    INTEGER     NOT NULL DEFAULT 1  CHECK (closure_target >= 0),
  set_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, target_month)
);

CREATE INDEX IF NOT EXISTS idx_user_targets_user  ON user_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_targets_month ON user_targets(target_month);

-- ============================================================
-- Done
-- ============================================================
