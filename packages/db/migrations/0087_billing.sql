CREATE TABLE "invoice_counters" (
	"financial_year" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"change" jsonb NOT NULL,
	"amount" integer NOT NULL,
	"cgst" integer DEFAULT 0 NOT NULL,
	"sgst" integer DEFAULT 0 NOT NULL,
	"igst" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"invoice_number" text,
	"invoice" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_razorpay_order_id_unique" UNIQUE("razorpay_order_id"),
	CONSTRAINT "payments_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'free' NOT NULL,
	"period" text DEFAULT 'year' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"students" integer DEFAULT 0 NOT NULL,
	"staff" integer DEFAULT 0 NOT NULL,
	"judges" integer DEFAULT 0 NOT NULL,
	"storage_packs" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"prices" jsonb,
	"price" integer DEFAULT 0 NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"next" jsonb,
	"over_since" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"billing_email" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_features" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_org" ON "payments" USING btree ("org_id","created_at");--> statement-breakpoint
-- Organizations from before billing keep everything they have: a custom plan with no limits
-- (plan_features stays null) until platform staff set one. Safe to run again.
INSERT INTO "subscriptions" ("org_id", "status", "notes")
SELECT "id", 'custom', 'From before billing: everything it had, until a plan is set.'
FROM "organizations"
ON CONFLICT ("org_id") DO NOTHING;
