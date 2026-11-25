CREATE TABLE "contest_virtuals" (
	"contest_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "contest_virtuals_contest_id_user_id_pk" PRIMARY KEY("contest_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "contest_virtuals" ADD CONSTRAINT "contest_virtuals_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_virtuals" ADD CONSTRAINT "contest_virtuals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;