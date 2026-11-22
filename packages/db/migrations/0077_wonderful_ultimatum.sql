ALTER TABLE "runners" ADD COLUMN "pool_org_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "pool_org_id" uuid;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_pool_org_id_organizations_id_fk" FOREIGN KEY ("pool_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_pool_org_id_organizations_id_fk" FOREIGN KEY ("pool_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_pool_queue" ON "submissions" USING btree ("pool_org_id","queue_at") WHERE status = 'queued';