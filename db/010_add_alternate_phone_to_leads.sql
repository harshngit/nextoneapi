-- ============================================================
-- Next One Realty CRM — Migration 010
-- Add alternate_phone_number column to leads table
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS alternate_phone_number VARCHAR(20);
