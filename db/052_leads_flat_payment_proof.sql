-- ============================================================
-- Migration 052 — Flatten lead payment proof to a single url + amount
-- ============================================================
-- Previously a lead could have MULTIPLE payment proofs, stored in the
-- separate payment_proofs table. This simplifies to exactly ONE payment
-- proof per lead, stored directly on the leads row.
--
-- The old payment_proofs table is NOT dropped — existing rows are copied
-- into the new columns (most recent proof per lead wins), and the table is
-- left in place, unused, in case the data is needed later.
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_proof_amount VARCHAR(100);

-- Backfill from the old payment_proofs table — take the most recent proof
-- per lead (if any existed).
UPDATE leads l
SET payment_proof_url = latest.url,
    payment_proof_amount = latest.amount
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, url, amount
  FROM payment_proofs
  ORDER BY lead_id, created_at DESC
) latest
WHERE l.id = latest.lead_id
  AND l.payment_proof_url IS NULL;

COMMENT ON COLUMN leads.payment_proof_url    IS 'Single payment proof file url (receipt/screenshot/PDF)';
COMMENT ON COLUMN leads.payment_proof_amount IS 'Free-text amount shown on the payment proof';
