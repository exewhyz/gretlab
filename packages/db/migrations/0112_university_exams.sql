CREATE TABLE "university_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"semester" integer NOT NULL,
	"name" text NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"internal_closed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "university_marks" (
	"exam_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"college_id" uuid NOT NULL,
	"internal" double precision,
	"external" double precision,
	"absent" boolean DEFAULT false NOT NULL,
	"internal_by" uuid,
	"external_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "university_marks_exam_id_subject_id_student_id_pk" PRIMARY KEY("exam_id","subject_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "university_exams" ADD CONSTRAINT "university_exams_university_id_organizations_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_exams" ADD CONSTRAINT "university_exams_program_id_org_groups_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."org_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_marks" ADD CONSTRAINT "university_marks_exam_id_university_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."university_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_marks" ADD CONSTRAINT "university_marks_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_marks" ADD CONSTRAINT "university_marks_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_marks" ADD CONSTRAINT "university_marks_college_id_organizations_id_fk" FOREIGN KEY ("college_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_marks" ADD CONSTRAINT "university_marks_internal_by_users_id_fk" FOREIGN KEY ("internal_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_marks" ADD CONSTRAINT "university_marks_external_by_users_id_fk" FOREIGN KEY ("external_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "university_exams_name" ON "university_exams" USING btree ("program_id","semester",lower("name"));--> statement-breakpoint
CREATE INDEX "university_exams_university" ON "university_exams" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "university_marks_student" ON "university_marks" USING btree ("student_id");