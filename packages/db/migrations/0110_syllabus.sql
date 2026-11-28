CREATE TABLE "class_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"semester" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "syllabus_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"semester" integer NOT NULL,
	"subject_id" uuid NOT NULL,
	"internal_max" integer NOT NULL,
	"external_max" integer NOT NULL,
	"pass_external" integer NOT NULL,
	"pass_total" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "source_subject_id" uuid;--> statement-breakpoint
ALTER TABLE "class_programs" ADD CONSTRAINT "class_programs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_programs" ADD CONSTRAINT "class_programs_group_id_org_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."org_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_programs" ADD CONSTRAINT "class_programs_university_id_organizations_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_programs" ADD CONSTRAINT "class_programs_program_id_org_groups_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."org_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_programs" ADD CONSTRAINT "class_programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_courses" ADD CONSTRAINT "syllabus_courses_university_id_organizations_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_courses" ADD CONSTRAINT "syllabus_courses_program_id_org_groups_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."org_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_courses" ADD CONSTRAINT "syllabus_courses_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_programs_group" ON "class_programs" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "class_programs_program" ON "class_programs" USING btree ("program_id","semester");--> statement-breakpoint
CREATE UNIQUE INDEX "syllabus_courses_unique" ON "syllabus_courses" USING btree ("program_id","semester","subject_id");--> statement-breakpoint
CREATE INDEX "syllabus_courses_university" ON "syllabus_courses" USING btree ("university_id");--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_source_subject_id_subjects_id_fk" FOREIGN KEY ("source_subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_source" ON "subjects" USING btree ("org_id","source_subject_id") WHERE "subjects"."source_subject_id" is not null;