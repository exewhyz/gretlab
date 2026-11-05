ALTER TABLE "organizations" ADD COLUMN "languages" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allow_paste" boolean DEFAULT true NOT NULL;