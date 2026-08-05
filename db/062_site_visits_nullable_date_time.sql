-- ============================================================
-- Migration 062 — site_visits.visit_date / visit_time become nullable
-- ============================================================
-- A lead's status can be set directly to 'site_visit_done' (PATCH
-- /leads/:id/status) without ever going through the formal site-visit
-- scheduling flow. When that happens and no site_visits row exists yet for
-- the lead, the backend now creates one synthetically (status='done') so the
-- lead shows up in the site-visit list and satisfies the closing-manager
-- gate — but there's no real visit date/time to record, hence nullable.

ALTER TABLE site_visits
  ALTER COLUMN visit_date DROP NOT NULL,
  ALTER COLUMN visit_time DROP NOT NULL;
