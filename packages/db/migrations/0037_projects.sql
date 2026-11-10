CREATE TABLE "assignment_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"points" integer DEFAULT 10 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_submissions" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"repo_url" text NOT NULL,
	"ref" text,
	"commit_sha" text,
	"note" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"mark" integer,
	"feedback" text DEFAULT '' NOT NULL,
	"marked_by" uuid,
	"marked_at" timestamp with time zone,
	CONSTRAINT "project_submissions_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "assignment_projects" ADD CONSTRAINT "assignment_projects_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_project_id_assignment_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."assignment_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_projects_by_assignment" ON "assignment_projects" USING btree ("assignment_id","position");