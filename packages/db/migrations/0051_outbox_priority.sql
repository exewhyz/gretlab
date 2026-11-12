ALTER TABLE "email_outbox" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "email_outbox_urgent" ON "email_outbox" USING btree ("status","urgent","next_attempt_at");