ALTER TABLE "org_groups" ADD COLUMN "starts_on" text;--> statement-breakpoint
ALTER TABLE "org_groups" ADD COLUMN "ends_on" text;--> statement-breakpoint
ALTER TABLE "org_groups" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "org_groups" ADD CONSTRAINT "org_groups_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;