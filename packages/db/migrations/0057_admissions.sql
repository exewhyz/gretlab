CREATE TABLE "admission_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"year_id" uuid,
	"grade_id" uuid,
	"applicant_id" uuid NOT NULL,
	"student_name" text NOT NULL,
	"birth_date" text NOT NULL,
	"gender" text DEFAULT '' NOT NULL,
	"previous_school" text DEFAULT '' NOT NULL,
	"parent_name" text NOT NULL,
	"relation" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"student_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_grade_id_org_groups_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."org_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_applications_number" ON "admission_applications" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "admission_applications_status" ON "admission_applications" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "admission_applications_applicant" ON "admission_applications" USING btree ("applicant_id");