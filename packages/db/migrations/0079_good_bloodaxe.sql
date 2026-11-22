ALTER TABLE "judge_machines" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "judge_machines" ADD COLUMN "update_wanted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_machines" ADD COLUMN "update_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "version" text;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "machine_id" text;--> statement-breakpoint
ALTER TABLE "judge_machines" ADD CONSTRAINT "judge_machines_replaces_id_judge_machines_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."judge_machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_machines" ADD CONSTRAINT "judge_machines_update_requested_by_users_id_fk" FOREIGN KEY ("update_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;