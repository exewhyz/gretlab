ALTER TABLE "judge_machines" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "last_busy_at" timestamp with time zone DEFAULT now() NOT NULL;