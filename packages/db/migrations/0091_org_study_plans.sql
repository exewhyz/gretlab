ALTER TABLE "problem_lists" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "problem_lists" ADD CONSTRAINT "problem_lists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_lists_org" ON "problem_lists" USING btree ("org_id");