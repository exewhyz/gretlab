ALTER TABLE "problems" ADD COLUMN "code" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Existing reference solutions are Python.
UPDATE "problems" SET "code" = jsonb_build_object('python', jsonb_build_object('solution', "solution")) WHERE "solution" <> '';
