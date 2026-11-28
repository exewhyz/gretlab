CREATE TABLE "university_reg_counters" (
	"university_id" uuid NOT NULL,
	"college_code" text NOT NULL,
	"admission_year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "university_reg_counters_university_id_college_code_admission_year_pk" PRIMARY KEY("university_id","college_code","admission_year")
);
--> statement-breakpoint
CREATE TABLE "university_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"college_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"admission_year" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reg_no" text,
	"note" text DEFAULT '' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "university_reg_counters" ADD CONSTRAINT "university_reg_counters_university_id_organizations_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_registrations" ADD CONSTRAINT "university_registrations_university_id_organizations_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_registrations" ADD CONSTRAINT "university_registrations_college_id_organizations_id_fk" FOREIGN KEY ("college_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_registrations" ADD CONSTRAINT "university_registrations_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_registrations" ADD CONSTRAINT "university_registrations_program_id_org_groups_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."org_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_registrations" ADD CONSTRAINT "university_registrations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_registrations" ADD CONSTRAINT "university_registrations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "university_registrations_live" ON "university_registrations" USING btree ("university_id","student_id") WHERE "university_registrations"."status" in ('requested', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "university_registrations_number" ON "university_registrations" USING btree ("university_id","reg_no") WHERE "university_registrations"."reg_no" is not null;--> statement-breakpoint
CREATE INDEX "university_registrations_college" ON "university_registrations" USING btree ("college_id","status");