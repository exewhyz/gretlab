CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"org_id" uuid,
	"group_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "certificates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_group_id_org_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."org_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificates_by_user" ON "certificates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "certificates_by_group" ON "certificates" USING btree ("group_id");