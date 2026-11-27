ALTER TABLE "referral_codes" ADD COLUMN "for_orgs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD COLUMN "combines" boolean DEFAULT false NOT NULL;