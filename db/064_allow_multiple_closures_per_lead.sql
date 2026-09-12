-- Allows a single lead to have more than one closure/booking record (e.g.
-- lead 1 can have 2 or more separate closures) instead of exactly one.
-- The application-level duplicate-closure check in closureController.js's
-- createClosure has been removed to match.
ALTER TABLE lead_closures DROP CONSTRAINT IF EXISTS lead_closures_lead_id_key;
