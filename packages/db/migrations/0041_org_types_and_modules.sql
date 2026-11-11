ALTER TYPE "public"."org_type" ADD VALUE 'school' BEFORE 'college';--> statement-breakpoint
ALTER TYPE "public"."org_type" ADD VALUE 'cohort' BEFORE 'company';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "modules" jsonb DEFAULT '{}'::jsonb NOT NULL;