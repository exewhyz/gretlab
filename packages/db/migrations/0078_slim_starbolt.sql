CREATE TABLE "judge_machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" text,
	"pool_org_id" uuid,
	"size" text NOT NULL,
	"stage" text DEFAULT 'requested' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_machines_instance_id_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
ALTER TABLE "judge_machines" ADD CONSTRAINT "judge_machines_pool_org_id_organizations_id_fk" FOREIGN KEY ("pool_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_machines" ADD CONSTRAINT "judge_machines_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judge_machines_stage" ON "judge_machines" USING btree ("stage");