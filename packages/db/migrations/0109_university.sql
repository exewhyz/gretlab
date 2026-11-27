ALTER TYPE "public"."org_type" ADD VALUE 'university' BEFORE 'coaching';--> statement-breakpoint
CREATE TABLE "org_affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"college_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"college_code" text,
	"note" text DEFAULT '' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "org_affiliations" ADD CONSTRAINT "org_affiliations_university_id_organizations_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_affiliations" ADD CONSTRAINT "org_affiliations_college_id_organizations_id_fk" FOREIGN KEY ("college_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_affiliations" ADD CONSTRAINT "org_affiliations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_affiliations" ADD CONSTRAINT "org_affiliations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_affiliations_one_live" ON "org_affiliations" USING btree ("college_id") WHERE status in ('requested', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "org_affiliations_code" ON "org_affiliations" USING btree ("university_id","college_code") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "org_affiliations_university" ON "org_affiliations" USING btree ("university_id","status");