CREATE TABLE "transfer_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" text NOT NULL,
	"leaving_date" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"conduct" text DEFAULT '' NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"details" text NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_certificates_number" ON "transfer_certificates" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "transfer_certificates_user" ON "transfer_certificates" USING btree ("user_id");