CREATE TABLE "course_reading_progress" (
	"reading_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_reading_progress_reading_id_user_id_pk" PRIMARY KEY("reading_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "course_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_reading_progress" ADD CONSTRAINT "course_reading_progress_reading_id_course_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."course_readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_reading_progress" ADD CONSTRAINT "course_reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_readings" ADD CONSTRAINT "course_readings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_readings_by_course" ON "course_readings" USING btree ("course_id");