CREATE TABLE "monitoring_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"level" text NOT NULL,
	"text" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_level" text,
	"notified_at" timestamp with time zone,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_alerts_open" ON "monitoring_alerts" USING btree ("key") WHERE "monitoring_alerts"."cleared_at" is null;--> statement-breakpoint
CREATE INDEX "monitoring_alerts_recent" ON "monitoring_alerts" USING btree ("first_seen_at");