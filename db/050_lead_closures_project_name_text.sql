-- ============================================================
-- Migration 050 — Allow closures to reference a project by free text
-- when it doesn't exist in the projects table yet (mirrors
-- leads.project_name_text / site_visits.project_name_text)
-- ============================================================

ALTER TABLE lead_closures ADD COLUMN IF NOT EXISTS project_name_text TEXT;

COMMENT ON COLUMN lead_closures.project_name_text IS 'Free-text project name when no matching project record exists';
