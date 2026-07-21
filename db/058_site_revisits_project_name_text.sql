-- site_revisits inherits its project from the original site_visits row, which
-- can legitimately have a NULL project_id (free-text project name — see
-- migration 046_site_visits_project_name_text.sql). site_revisits had no
-- equivalent fallback column and project_id was still NOT NULL, so creating
-- a re-visit for a free-text-project visit violated the not-null constraint.
ALTER TABLE site_revisits
  ADD COLUMN IF NOT EXISTS project_name_text TEXT,
  ALTER COLUMN project_id DROP NOT NULL;
