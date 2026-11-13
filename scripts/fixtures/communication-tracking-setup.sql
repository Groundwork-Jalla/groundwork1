RESET ROLE;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workflow_origin text NOT NULL DEFAULT 'client';
ALTER TABLE contractor_invites ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE contractor_invites ADD COLUMN IF NOT EXISTS email_delivered_at timestamptz;
ALTER TABLE project_viewers ADD COLUMN IF NOT EXISTS email_delivered_at timestamptz;
CREATE TEMP TABLE tracking_enablement_snapshot AS SELECT
 (SELECT jsonb_agg(jsonb_build_object('key',key,'enabled',enabled) ORDER BY key) FROM lifecycle_sequences) AS journeys,
 (SELECT delivery_enabled FROM communication_settings WHERE id) AS delivery_enabled;
