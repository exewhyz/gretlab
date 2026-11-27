CREATE TABLE "fee_concessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"head_id" uuid,
	"percent" integer,
	"amount" integer,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"given_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_heads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gst_rate" integer DEFAULT 0 NOT NULL,
	"applies_to" text DEFAULT 'everyone' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"mode" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"allocation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"cancel_reason" text,
	"receipt_no" text,
	"receipt" text,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"collected_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"audience" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"instalments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_receipt_counters" (
	"org_id" uuid NOT NULL,
	"financial_year" text NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_receipt_counters_org_id_financial_year_pk" PRIMARY KEY("org_id","financial_year")
);
--> statement-breakpoint
CREATE TABLE "fee_reminders_sent" (
	"plan_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"instalment_id" text NOT NULL,
	"step" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_reminders_sent_plan_id_student_id_instalment_id_step_pk" PRIMARY KEY("plan_id","student_id","instalment_id","step")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "fee_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fee_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_given_by_users_id_fk" FOREIGN KEY ("given_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fee_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipt_counters" ADD CONSTRAINT "fee_receipt_counters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminders_sent" ADD CONSTRAINT "fee_reminders_sent_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fee_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminders_sent" ADD CONSTRAINT "fee_reminders_sent_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_concessions_student" ON "fee_concessions" USING btree ("plan_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_heads_name" ON "fee_heads" USING btree ("org_id",lower(name));--> statement-breakpoint
CREATE INDEX "fee_payments_student" ON "fee_payments" USING btree ("org_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_payments_paid" ON "fee_payments" USING btree ("org_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payments_receipt" ON "fee_payments" USING btree ("org_id","receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payments_order" ON "fee_payments" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE INDEX "fee_plans_org_year" ON "fee_plans" USING btree ("org_id","year_id");