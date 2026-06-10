-- ============================================================
-- Migration: Add configuration column to leads table
-- ============================================================

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS configuration VARCHAR(255);
