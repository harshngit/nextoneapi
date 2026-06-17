-- ============================================================
-- Migration 036 — Seed explicit "targets" module permissions
-- ============================================================
-- Fixes roles (especially associate → hr_admin) that may have
-- ended up with all-false targets permissions after migration 035
-- ran before their rows existed in role_permissions.
--
-- Uses a CTE + JSONB merge (||) so ONLY the "targets" key is
-- touched — all other module permissions remain unchanged.
-- Safe to re-run at any time (idempotent).
-- ============================================================

WITH role_target_perms (role, perms) AS (
  VALUES
    -- Full management: can view/set/edit/delete/export targets for everyone
    ('admin',             '{"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true}'::jsonb),

    -- Team management: can set targets for their team but not delete
    ('sales_manager',     '{"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true}'::jsonb),

    -- View own target only (individual contributors)
    ('sales_executive',   '{"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}'::jsonb),
    ('external_caller',   '{"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}'::jsonb),
    ('associate',         '{"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}'::jsonb),

    -- Team-lead level: can set targets for their team
    ('associate_partner', '{"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true}'::jsonb),
    ('partner',           '{"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true}'::jsonb),
    ('team_leader',       '{"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true}'::jsonb),
    ('cluster',           '{"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true}'::jsonb),
    ('cluster_head',      '{"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true}'::jsonb),

    -- Non-sales roles: no targets access
    ('digital_marketing', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false}'::jsonb),

    -- HR: view + export for payroll/reporting (but cannot set targets)
    ('hr_admin',          '{"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true}'::jsonb)
)
UPDATE role_permissions rp
SET
  permissions = rp.permissions || jsonb_build_object('targets', rtp.perms),
  updated_at  = NOW()
FROM role_target_perms rtp
WHERE rp.role = rtp.role;
