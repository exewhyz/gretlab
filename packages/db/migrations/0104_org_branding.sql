ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "branding" jsonb DEFAULT '{}'::jsonb NOT NULL;
