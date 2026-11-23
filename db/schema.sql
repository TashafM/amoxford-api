-- A.M. Oxford API schema. Safe to run more than once.
-- Ids are text: migrated rows keep their old MongoDB ObjectId (24 hex chars) so
-- existing login tokens, reset links and frontend URLs keep working.

CREATE TABLE IF NOT EXISTS users (
  id          text PRIMARY KEY,
  firstname   text NOT NULL,
  lastname    text NOT NULL,
  email       text NOT NULL UNIQUE,
  password    text NOT NULL,              -- bcrypt hash
  role        text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notices (
  id          text PRIMARY KEY,
  date        text NOT NULL,              -- ms timestamp as text, the format both frontends expect
  notice      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_created_at_idx ON notices (created_at DESC);

CREATE TABLE IF NOT EXISTS enquiries (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  phone_number  text NOT NULL,
  message       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enquiries_created_at_idx ON enquiries (created_at DESC);

CREATE TABLE IF NOT EXISTS images (
  id          text PRIMARY KEY,
  filename    text NOT NULL UNIQUE,       -- R2 key; thumbnail is thumbs/<filename>
  category    text NOT NULL,              -- category slug
  "timestamp" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_category_ts_idx ON images (category, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS images_ts_idx ON images ("timestamp" DESC);

-- One table for the three gallery sections (three collections in MongoDB).
CREATE TABLE IF NOT EXISTS categories (
  id            text PRIMARY KEY,
  section       text NOT NULL CHECK (section IN ('events', 'extra-curricular', 'pre-primary')),
  name          text NOT NULL,
  slug          text NOT NULL,
  banner_image  text NOT NULL DEFAULT '#'
);
CREATE INDEX IF NOT EXISTS categories_section_idx ON categories (section);
CREATE INDEX IF NOT EXISTS categories_slug_idx ON categories (slug);

-- Supabase exposes tables in "public" through its Data API (anon key). Row Level Security
-- with no policies blocks that API completely. This server connects as the database owner,
-- which bypasses RLS, so the app is unaffected.
ALTER TABLE users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE images     ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Per-key rate limits (login, forgot password, enquiry form). Stored here because
-- serverless instances do not share memory. Old rows are removed by the daily cron.
CREATE TABLE IF NOT EXISTS rate_limits (
  key           text PRIMARY KEY,
  hits          integer NOT NULL,
  window_start  timestamptz NOT NULL
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
