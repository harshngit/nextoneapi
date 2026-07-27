-- ============================================================
-- Migration 060 — Add closing_person to leads
-- ============================================================
-- Free-text closing-manager name, not tied to a user account — mirrors the
-- closing_person column already on site_visits/site_revisits (alongside
-- their UUID closing_manager). Set via PATCH /api/v1/leads/:id/closing-manager.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS closing_person VARCHAR(255);
