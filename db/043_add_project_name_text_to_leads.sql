-- Migration 043: Add project_name_text column to leads
-- Allows storing a free-text project name when no matching project record exists.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_name_text TEXT;
