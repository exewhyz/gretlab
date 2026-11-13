DROP INDEX "attendance_register_unique";--> statement-breakpoint
ALTER TABLE "teaching_sessions" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teaching_sessions_subject" ON "teaching_sessions" USING btree ("subject_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_register_unique" ON "teaching_sessions" USING btree ("group_id","day","period",coalesce("subject_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "teaching_sessions"."kind" = 'register';