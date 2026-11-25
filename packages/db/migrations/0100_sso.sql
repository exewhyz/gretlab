CREATE TABLE "org_sso" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"client_secret" text DEFAULT '' NOT NULL,
	"authorization_endpoint" text DEFAULT '' NOT NULL,
	"token_endpoint" text DEFAULT '' NOT NULL,
	"jwks_uri" text DEFAULT '' NOT NULL,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_states" (
	"state" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"verifier" text NOT NULL,
	"next" text DEFAULT '/home' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sso_users" (
	"org_id" uuid NOT NULL,
	"sub" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_users_org_id_sub_pk" PRIMARY KEY("org_id","sub")
);
--> statement-breakpoint
ALTER TABLE "org_sso" ADD CONSTRAINT "org_sso_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_states" ADD CONSTRAINT "sso_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_users" ADD CONSTRAINT "sso_users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_users" ADD CONSTRAINT "sso_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;