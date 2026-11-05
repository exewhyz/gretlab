CREATE TABLE "runners" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"slots" integer NOT NULL,
	"busy" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "submissions_queue";--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "queue_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "submissions_active_user" ON "submissions" USING btree ("user_id") WHERE status <> 'done';--> statement-breakpoint
CREATE INDEX "submissions_leases" ON "submissions" USING btree ("locked_until") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "submissions_old_runs" ON "submissions" USING btree ("created_at") WHERE kind = 'run';--> statement-breakpoint
CREATE INDEX "submissions_queue" ON "submissions" USING btree ("queue_at") WHERE status = 'queued';