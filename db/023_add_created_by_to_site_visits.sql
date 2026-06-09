-- ============================================================
-- Migration 023 — Add created_by column to site_visits table
-- ============================================================

ALTER TABLE site_visits
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
