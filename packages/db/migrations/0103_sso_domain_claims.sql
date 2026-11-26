CREATE TABLE "sso_domain_claims" (
	"org_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "sso_domain_claims_org_id_domain_pk" PRIMARY KEY("org_id","domain")
);
--> statement-breakpoint
ALTER TABLE "sso_domain_claims" ADD CONSTRAINT "sso_domain_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;