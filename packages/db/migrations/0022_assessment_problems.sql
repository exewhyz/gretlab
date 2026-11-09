ALTER TABLE "problems" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "exam_sessions_by_user" ON "exam_sessions" USING btree ("user_id","ends_at");