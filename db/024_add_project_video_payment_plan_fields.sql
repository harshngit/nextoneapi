-- ============================================================
-- Migration 024 — Add video_url, payment_plan, home_loan_info to projects
--              and update project_documents document_type
-- ============================================================

-- 1. Add new columns to projects table
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS video_url TEXT,
ADD COLUMN IF NOT EXISTS payment_plan TEXT,
ADD COLUMN IF NOT EXISTS home_loan_info TEXT;

-- 2. Update project_documents document_type check constraint
-- First, drop existing constraint, then add new one with more options
ALTER TABLE project_documents 
DROP CONSTRAINT IF EXISTS project_documents_document_type_check;

ALTER TABLE project_documents 
ADD CONSTRAINT project_documents_document_type_check 
CHECK (document_type IN ('unit_plan', 'creative', 'payment_plan', 'video'));
