-- ============================================================
-- Migration 051 — Add 'booking_form' as a valid closure document_type
-- (in addition to cost_sheet, payment_proof)
-- ============================================================

ALTER TABLE closure_documents DROP CONSTRAINT IF EXISTS closure_documents_document_type_check;
ALTER TABLE closure_documents ADD CONSTRAINT closure_documents_document_type_check CHECK (document_type IN (
  'cost_sheet','payment_proof','booking_form'
));
