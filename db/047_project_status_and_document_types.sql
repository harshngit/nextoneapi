-- ============================================================
-- Migration 047 — Expand project status + project_documents document_type
-- ============================================================

-- New project lifecycle statuses: under_construction, pre_launch,
-- nearby_possession, ready_to_move (in addition to the existing ones)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN (
  'active','inactive','upcoming','completed',
  'under_construction','pre_launch','nearby_possession','ready_to_move'
));

-- New document types: photo (project photo gallery), developer_logo
ALTER TABLE project_documents DROP CONSTRAINT IF EXISTS project_documents_document_type_check;
ALTER TABLE project_documents ADD CONSTRAINT project_documents_document_type_check CHECK (document_type IN (
  'unit_plan','creative','payment_plan','video','photo','developer_logo'
));
