ALTER TYPE "public"."org_type" ADD VALUE 'coaching' BEFORE 'cohort';--> statement-breakpoint
CREATE TABLE "org_kind_policies" (
	"kind" "org_type" PRIMARY KEY NOT NULL,
	"modules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_kind_policies" ADD CONSTRAINT "org_kind_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;