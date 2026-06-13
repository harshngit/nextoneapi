-- ============================================================
-- Migration 031 (Part 1) — Fix role_permissions CHECK constraint
-- Run this BEFORE 031_access_control_expansion.sql
-- ============================================================
-- The existing role_permissions table has a CHECK constraint that
-- only allows 4 roles. We need to expand it to all 12 roles.
-- Since it's a PRIMARY KEY with an inline CHECK, we must recreate
-- the table (same pattern as migration 020 used).
-- ============================================================

-- Step 1: Rename the existing table
ALTER TABLE role_permissions RENAME TO role_permissions_old;

-- Step 2: Create new table with expanded CHECK (all 12 configurable roles)
CREATE TABLE role_permissions (
  role         VARCHAR(30) PRIMARY KEY CHECK (role IN (
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
               )),
  display_name VARCHAR(100),
  permissions  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Copy all existing rows (the 4 old roles will copy cleanly)
INSERT INTO role_permissions
SELECT role, display_name, permissions, updated_at
FROM role_permissions_old
WHERE role IN (
  'admin', 'sales_manager', 'sales_executive', 'external_caller',
  'associate', 'associate_partner', 'partner', 'team_leader',
  'cluster', 'cluster_head', 'digital_marketing', 'hr_admin'
);

-- Step 4: Drop the old table
DROP TABLE role_permissions_old;