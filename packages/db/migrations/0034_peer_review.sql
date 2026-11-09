CREATE TABLE "peer_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"submission_id" uuid,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"line_comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "peer_review" jsonb;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "peer_reviews_pair" ON "peer_reviews" USING btree ("assignment_id","problem_id","reviewer_id","author_id");--> statement-breakpoint
CREATE INDEX "peer_reviews_reviewer" ON "peer_reviews" USING btree ("reviewer_id");