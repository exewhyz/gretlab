CREATE TABLE "two_factor" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret" text,
	"enabled_at" timestamp with time zone,
	"last_step" integer,
	"backup_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_secret" text,
	"pending_backup_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"email_on" boolean DEFAULT false NOT NULL,
	"email_code" text,
	"email_code_expires" timestamp with time zone,
	"email_code_tries" integer DEFAULT 0 NOT NULL,
	"email_sent_at" timestamp with time zone,
	"email_sends" integer DEFAULT 0 NOT NULL,
	"email_window_start" timestamp with time zone,
	"trust_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;