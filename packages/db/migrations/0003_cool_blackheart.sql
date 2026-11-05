CREATE TYPE "public"."list_kind" AS ENUM('favorites', 'custom', 'study_plan');--> statement-breakpoint
CREATE TABLE "daily_challenges" (
	"day" text PRIMARY KEY NOT NULL,
	"problem_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problem_list_items" (
	"list_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "problem_list_items_list_id_problem_id_pk" PRIMARY KEY("list_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "problem_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"kind" "list_kind" DEFAULT 'custom' NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_lists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "problem_notes" (
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_notes_user_id_problem_id_pk" PRIMARY KEY("user_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "problem_tags" (
	"problem_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "problem_tags_problem_id_tag_id_pk" PRIMARY KEY("problem_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "hints" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "editorial" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_list_items" ADD CONSTRAINT "problem_list_items_list_id_problem_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."problem_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_list_items" ADD CONSTRAINT "problem_list_items_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_lists" ADD CONSTRAINT "problem_lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_notes" ADD CONSTRAINT "problem_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_notes" ADD CONSTRAINT "problem_notes_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_lists_owner" ON "problem_lists" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "problem_tags_tag" ON "problem_tags" USING btree ("tag_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_unique" UNIQUE("handle");--> statement-breakpoint
-- Handles for existing accounts: the email's local part, made unique with a number.
UPDATE "users" u SET "handle" = h.handle FROM (
  SELECT id, base || CASE WHEN rn > 1 THEN '-' || rn ELSE '' END AS handle FROM (
    SELECT id,
      coalesce(nullif(trim(both '-' from regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9]+', '-', 'g')), ''), 'user') AS base,
      row_number() OVER (PARTITION BY coalesce(nullif(trim(both '-' from regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9]+', '-', 'g')), ''), 'user') ORDER BY created_at, id) AS rn
    FROM "users"
  ) x
) h WHERE u.id = h.id AND u.handle IS NULL;
