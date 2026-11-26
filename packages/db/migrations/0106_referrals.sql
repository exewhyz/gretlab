CREATE TABLE "org_referrals" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"referrer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner_id" uuid,
	"percent" integer,
	"months" integer,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"referrer_id" uuid,
	"amount" integer NOT NULL,
	"percent" integer NOT NULL,
	"status" text DEFAULT 'owed' NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"payout_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_earnings_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "coupon" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "discount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_referrals" ADD CONSTRAINT "org_referrals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_referrals" ADD CONSTRAINT "org_referrals_code_referral_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."referral_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_referrals" ADD CONSTRAINT "org_referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_personal" ON "referral_codes" USING btree ("owner_id") WHERE kind = 'personal';--> statement-breakpoint
CREATE INDEX "referral_earnings_by" ON "referral_earnings" USING btree ("referrer_id","created_at");