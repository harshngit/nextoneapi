-- ============================================================
-- Migration 048 — Drop the hardcoded leads.status CHECK constraint
-- ============================================================
-- leads.status previously had a CHECK constraint hardcoding only the 9
-- system statuses (new, contacted, ... lost). That made it impossible to
-- ever actually save a custom status (from the lead_statuses table) onto a
-- lead — the INSERT/UPDATE would be rejected by Postgres before the app's
-- own validation (isValidLeadStatus) even mattered.
--
-- Valid statuses are now fully governed by the lead_statuses table + the
-- app-level check in leadController.js, so the DB-level CHECK is dropped.
-- ============================================================

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
