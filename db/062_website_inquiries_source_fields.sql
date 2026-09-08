-- Adds fields needed by the source-specific inquiry endpoints (Facebook,
-- WhatsApp, Instagram) and the normal website "Contact Us" form: alternate
-- phone number and configuration (unit type interested in). Also registers
-- WhatsApp and Website as lead sources — Facebook and Instagram were already
-- seeded in 005_system_config_migration.sql — so all four inquiry channels
-- show up consistently in source dropdowns/config.

ALTER TABLE website_inquiries
  ADD COLUMN IF NOT EXISTS alternate_phone_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS configuration          VARCHAR(100);

INSERT INTO lead_sources (name) VALUES
  ('WhatsApp'), ('Website')
ON CONFLICT (name) DO NOTHING;
