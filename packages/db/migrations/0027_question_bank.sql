CREATE TABLE "assignment_questions" (
	"assignment_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assignment_questions_assignment_id_question_id_pk" PRIMARY KEY("assignment_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "contest_answers" (
	"contest_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_answers_contest_id_question_id_user_id_pk" PRIMARY KEY("contest_id","question_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "contest_questions" (
	"contest_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"label" text NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "contest_questions_contest_id_question_id_pk" PRIMARY KEY("contest_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "daily_answers" (
	"day" text NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_answers_day_user_id_pk" PRIMARY KEY("day","user_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_responses" (
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"marks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_responses_assignment_id_user_id_pk" PRIMARY KEY("assignment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "daily_challenges" ALTER COLUMN "problem_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD COLUMN "question_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_answers" ADD CONSTRAINT "contest_answers_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_answers" ADD CONSTRAINT "contest_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_answers" ADD CONSTRAINT "contest_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_answers" ADD CONSTRAINT "daily_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_answers" ADD CONSTRAINT "daily_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_responses" ADD CONSTRAINT "quiz_responses_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_responses" ADD CONSTRAINT "quiz_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_by_org" ON "questions" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;