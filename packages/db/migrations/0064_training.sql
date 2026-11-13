ALTER TABLE "certificates" ADD COLUMN "expires_on" text;--> statement-breakpoint
ALTER TABLE "course_classes" ADD COLUMN "due_on" text;--> statement-breakpoint
ALTER TABLE "course_classes" ADD COLUMN "renew_months" integer;