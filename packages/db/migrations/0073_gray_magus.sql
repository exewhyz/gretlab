CREATE TABLE "course_attempts" (
	"checkpoint_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "course_attempts_checkpoint_id_user_id_pk" PRIMARY KEY("checkpoint_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "course_checkpoint_items" (
	"checkpoint_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "course_checkpoint_items_checkpoint_id_item_type_item_id_pk" PRIMARY KEY("checkpoint_id","item_type","item_id")
);
--> statement-breakpoint
CREATE TABLE "course_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"time_limit" integer,
	"weight" integer DEFAULT 1 NOT NULL,
	"points" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_project_submissions" (
	"checkpoint_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"repo_url" text NOT NULL,
	"ref" text,
	"commit_sha" text,
	"note" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mark" integer,
	"feedback" text DEFAULT '' NOT NULL,
	"marked_by" uuid,
	"marked_at" timestamp with time zone,
	CONSTRAINT "course_project_submissions_checkpoint_id_user_id_pk" PRIMARY KEY("checkpoint_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "course_quiz_answers" (
	"checkpoint_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_quiz_answers_checkpoint_id_user_id_question_id_pk" PRIMARY KEY("checkpoint_id","user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "course_attempts" ADD CONSTRAINT "course_attempts_checkpoint_id_course_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."course_checkpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_attempts" ADD CONSTRAINT "course_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_checkpoint_items" ADD CONSTRAINT "course_checkpoint_items_checkpoint_id_course_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."course_checkpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_checkpoints" ADD CONSTRAINT "course_checkpoints_module_id_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_project_submissions" ADD CONSTRAINT "course_project_submissions_checkpoint_id_course_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."course_checkpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_project_submissions" ADD CONSTRAINT "course_project_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_project_submissions" ADD CONSTRAINT "course_project_submissions_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_quiz_answers" ADD CONSTRAINT "course_quiz_answers_checkpoint_id_course_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."course_checkpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_quiz_answers" ADD CONSTRAINT "course_quiz_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_quiz_answers" ADD CONSTRAINT "course_quiz_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_checkpoint_items_by_item" ON "course_checkpoint_items" USING btree ("item_type","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_checkpoints_module_kind" ON "course_checkpoints" USING btree ("module_id","kind");