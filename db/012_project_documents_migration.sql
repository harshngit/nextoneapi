-- ============================================================
-- Next One Realty CRM — Migration
-- Table: project_documents
-- Description: Store uploaded documents (unit plans, creatives) 
--              for projects with file metadata
-- ============================================================

-- ─── Project Documents Table ──────────────────────────────
CREATE TABLE IF NOT EXISTS project_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_type   VARCHAR(20) NOT NULL CHECK (document_type IN ('unit_plan', 'creative')),
  file_name       VARCHAR(255) NOT NULL,
  file_path       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  mime_type       VARCHAR(100) NOT NULL,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_documents_project 
  ON project_documents(project_id);
  
CREATE INDEX IF NOT EXISTS idx_project_documents_type 
  ON project_documents(document_type);
  
CREATE INDEX IF NOT EXISTS idx_project_documents_uploaded_at 
  ON project_documents(uploaded_at);

-- ─── Comments ─────────────────────────────────────────────
COMMENT ON TABLE project_documents IS 'Stores uploaded unit plans and creative documents for projects';
COMMENT ON COLUMN project_documents.document_type IS 'Type of document: unit_plan or creative';
COMMENT ON COLUMN project_documents.file_path IS 'Full file path on server filesystem';
COMMENT ON COLUMN project_documents.file_size IS 'File size in bytes';
