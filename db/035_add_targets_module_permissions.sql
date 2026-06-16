-- ============================================================
-- Migration 035 — Add "targets" module to Access Control
-- ============================================================
-- Adds the new "targets" module (monthly site-visit / closure targets,
-- see src/controllers/targetController.js) into every existing role's
-- permissions JSONB. Mirrors each role's existing "closures" permissions,
-- since targets track the same site-visit + closure performance data.
--
-- super_admin is never stored here — it always has full access (handled
-- in application code).
--
-- Safe to re-run: uses jsonb merge (||), only touches the "targets" key.
-- ============================================================

UPDATE role_permissions
SET permissions = permissions || jsonb_build_object('targets', permissions->'closures'),
    updated_at  = NOW()
WHERE role IN (
  'admin', 'sales_manager', 'sales_executive', 'external_caller',
  'associate', 'associate_partner', 'partner', 'team_leader',
  'cluster', 'cluster_head', 'digital_marketing', 'hr_admin'
)
AND permissions ? 'closures';

-- Fallback for any role row that somehow has no "closures" key yet —
-- give it an all-false "targets" entry instead of leaving it unset.
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object('targets', jsonb_build_object(
      'view', false, 'create', false, 'edit', false,
      'delete', false, 'approve', false, 'export', false
    )),
    updated_at = NOW()
WHERE role IN (
  'admin', 'sales_manager', 'sales_executive', 'external_caller',
  'associate', 'associate_partner', 'partner', 'team_leader',
  'cluster', 'cluster_head', 'digital_marketing', 'hr_admin'
)
AND NOT (permissions ? 'targets');
