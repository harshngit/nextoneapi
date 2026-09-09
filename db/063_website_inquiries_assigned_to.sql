-- Lets a website inquiry be assigned to a staff member directly (before it's
-- converted to a lead), and keeps that assignment in sync with the lead's
-- own assigned_to once the inquiry is converted.

ALTER TABLE website_inquiries
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_website_inquiries_assigned_to ON website_inquiries(assigned_to);
