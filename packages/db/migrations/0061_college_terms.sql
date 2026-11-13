CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "credits" double precision;--> statement-breakpoint
ALTER TABLE "term_exams" ADD COLUMN "term_id" uuid;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_name" ON "academic_terms" USING btree ("year_id",lower("name"));--> statement-breakpoint
CREATE INDEX "academic_terms_org" ON "academic_terms" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "term_exams" ADD CONSTRAINT "term_exams_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE set null ON UPDATE no action;