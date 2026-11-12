ALTER TABLE "attendance" ADD COLUMN "status" text DEFAULT 'present' NOT NULL;--> statement-breakpoint
ALTER TABLE "teaching_sessions" ADD COLUMN "kind" text DEFAULT 'class' NOT NULL;--> statement-breakpoint
ALTER TABLE "teaching_sessions" ADD COLUMN "period" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_register_unique" ON "teaching_sessions" USING btree ("group_id","day","period") WHERE "teaching_sessions"."kind" = 'register';--> statement-breakpoint
-- Existing marks: those not present were absent.
UPDATE "attendance" SET "status" = 'absent' WHERE NOT "present";
