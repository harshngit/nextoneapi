-- Authorized signature image shown on the salary slip PDF.
ALTER TABLE salary_slips
  ADD COLUMN IF NOT EXISTS auth_signature_url TEXT;
