-- ============================================================
-- Next One Realty CRM — Migration
-- Tables: projects, leads, lead_activities,
--         site_visits, site_visit_feedback
-- ============================================================

-- ─── Projects Table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(255) NOT NULL,
  developer        VARCHAR(255),
  city             VARCHAR(100) NOT NULL,
  locality         VARCHAR(100),
  address          TEXT,
  configurations   JSONB DEFAULT '[]',
  price_range      VARCHAR(100),
  total_units      INTEGER,
  possession_date  DATE,
  rera_number      VARCHAR(100),
  amenities        JSONB DEFAULT '[]',
  status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','upcoming','completed')),
  brochure_url     TEXT,
  description      TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_city   ON projects(city);

-- ─── Leads Table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                VARCHAR(255) NOT NULL,
  phone               VARCHAR(20) NOT NULL,
  email               VARCHAR(255),
  source              VARCHAR(100),
  status              VARCHAR(50) DEFAULT 'new' CHECK (status IN (
                        'new','contacted','interested','follow_up',
                        'site_visit_scheduled','site_visit_done',
                        'negotiation','booked','lost'
                      )),
  budget              VARCHAR(100),
  location_preference VARCHAR(255),
  project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
  assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  is_archived         BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned    ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_project     ON leads(project_id);
CREATE INDEX IF NOT EXISTS idx_leads_is_archived ON leads(is_archived);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);

-- ─── Lead Activities Table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_activities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL CHECK (type IN ('note','call','email','whatsapp','meeting','status_change','assignment')),
  note         TEXT NOT NULL,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_type ON lead_activities(type);

-- ─── Site Visits Table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_visits (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  visit_date          DATE NOT NULL,
  visit_time          TIME NOT NULL,
  assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
  status              VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN (
                        'scheduled','done','cancelled','rescheduled','no_show'
                      )),
  transport_arranged  BOOLEAN DEFAULT false,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_visits_lead       ON site_visits(lead_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_assigned   ON site_visits(assigned_to);
CREATE INDEX IF NOT EXISTS idx_site_visits_status     ON site_visits(status);
CREATE INDEX IF NOT EXISTS idx_site_visits_visit_date ON site_visits(visit_date);

-- ─── Site Visit Feedback Table ────────────────────────────────
CREATE TABLE IF NOT EXISTS site_visit_feedback (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_visit_id   UUID UNIQUE NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
  client_reaction VARCHAR(30) CHECK (client_reaction IN ('very_positive','positive','neutral','negative','not_interested')),
  interested_in   VARCHAR(255),
  next_step       VARCHAR(30) CHECK (next_step IN ('negotiation','follow_up','send_proposal','booked','lost')),
  remarks         TEXT,
  submitted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
