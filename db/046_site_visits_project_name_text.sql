-- ============================================================
-- Migration 046 — Allow site visits to reference a project by free text
-- when it doesn't exist in the projects table yet (mirrors leads.project_name_text)
-- ============================================================

ALTER TABLE site_visits ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS project_name_text TEXT;

COMMENT ON COLUMN site_visits.project_name_text IS 'Free-text project name when no matching project record exists';
