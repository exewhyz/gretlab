ALTER TABLE "audit_log" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "support" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_org_category" ON "audit_log" USING btree ("org_id","category","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_actor" ON "audit_log" USING btree ("org_id","actor_id","created_at");--> statement-breakpoint
UPDATE "audit_log" SET "category" = split_part("action", '.', 1) WHERE "category" = '';--> statement-breakpoint
UPDATE "audit_log" a SET "actor_label" = coalesce(nullif(u."name", '') || ' <' || u."email" || '>', u."email") FROM "users" u WHERE a."actor_id" = u."id" AND a."actor_label" = '';
