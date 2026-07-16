-- Website inquiries: general "Contact Us" form submissions from the public
-- website. Captured without auth, triaged and converted by staff.
CREATE TABLE IF NOT EXISTS website_inquiries (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               VARCHAR(255) NOT NULL,
  phone              VARCHAR(20)  NOT NULL,
  email              VARCHAR(255),
  message            TEXT,
  project_id         UUID        REFERENCES projects(id) ON DELETE SET NULL,
  project_name_text  TEXT,
  source             VARCHAR(100) DEFAULT 'Website',
  status             VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'spam', 'closed')),
  converted_to       VARCHAR(20) CHECK (converted_to IN ('lead', 'follow_up', 'site_visit')),
  lead_id            UUID        REFERENCES leads(id) ON DELETE SET NULL,
  converted_at       TIMESTAMPTZ,
  converted_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  ip_address         VARCHAR(64),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_website_inquiries_status     ON website_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_website_inquiries_created_at ON website_inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_website_inquiries_phone      ON website_inquiries(phone);
