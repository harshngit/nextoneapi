-- ============================================================
-- Migration 041 — Add closing_manager to site_visits and site_revisits
-- ============================================================

-- Add closing_manager to site_visits table
ALTER TABLE site_visits 
  ADD COLUMN IF NOT EXISTS closing_manager UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add closing_manager to site_revisits table
ALTER TABLE site_revisits 
  ADD COLUMN IF NOT EXISTS closing_manager UUID REFERENCES users(id) ON DELETE SET NULL;
