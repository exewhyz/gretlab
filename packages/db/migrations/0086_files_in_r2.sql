ALTER TABLE "job_files" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "job_files" ADD COLUMN "stored_in" text DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_files" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "stored_in" text DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "key" text;