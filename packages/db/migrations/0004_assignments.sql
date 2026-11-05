CREATE TABLE "assignment_problems" (
	"assignment_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 100 NOT NULL,
	CONSTRAINT "assignment_problems_assignment_id_problem_id_pk" PRIMARY KEY("assignment_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"allow_late" boolean DEFAULT false NOT NULL,
	"late_penalty_percent" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "assignment_problems" ADD CONSTRAINT "assignment_problems_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_problems" ADD CONSTRAINT "assignment_problems_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_problem_graded" ON "submissions" USING btree ("problem_id","created_at") WHERE kind = 'submit' and status = 'done';