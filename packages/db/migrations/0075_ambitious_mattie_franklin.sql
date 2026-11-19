ALTER TABLE "assignments" ADD COLUMN "execution" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "submissions_per_minute" integer;--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN "execution" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN "submissions_per_minute" integer;--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "platform_modules" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "execution" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "provisional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "submissions_provisional" ON "submissions" USING btree ("created_at") WHERE provisional;