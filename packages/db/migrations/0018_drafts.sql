CREATE TABLE "draft_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"language" text NOT NULL,
	"files" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"language" text NOT NULL,
	"files" jsonb NOT NULL,
	"entry" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_user_id_problem_id_language_pk" PRIMARY KEY("user_id","problem_id","language")
);
--> statement-breakpoint
ALTER TABLE "draft_snapshots" ADD CONSTRAINT "draft_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_snapshots" ADD CONSTRAINT "draft_snapshots_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_snapshots_by" ON "draft_snapshots" USING btree ("user_id","problem_id","at");--> statement-breakpoint
CREATE INDEX "drafts_problem" ON "drafts" USING btree ("problem_id");