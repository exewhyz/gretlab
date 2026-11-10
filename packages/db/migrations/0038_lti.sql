CREATE TABLE "lti_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_id" uuid NOT NULL,
	"context_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_deep_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"deployment_id" text NOT NULL,
	"return_url" text NOT NULL,
	"data" text,
	"context_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lti_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"private_key" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_id" uuid NOT NULL,
	"resource_link_id" text NOT NULL,
	"context_id" uuid,
	"assignment_id" uuid,
	"line_item_url" text,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"deployment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth_url" text NOT NULL,
	"token_url" text NOT NULL,
	"jwks_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_states" (
	"state" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"platform_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lti_users" (
	"platform_id" uuid NOT NULL,
	"sub" text NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "lti_users_platform_id_sub_pk" PRIMARY KEY("platform_id","sub")
);
--> statement-breakpoint
ALTER TABLE "lti_contexts" ADD CONSTRAINT "lti_contexts_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_contexts" ADD CONSTRAINT "lti_contexts_group_id_org_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."org_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_deep_links" ADD CONSTRAINT "lti_deep_links_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_deep_links" ADD CONSTRAINT "lti_deep_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_deep_links" ADD CONSTRAINT "lti_deep_links_context_id_lti_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."lti_contexts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_links" ADD CONSTRAINT "lti_links_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_links" ADD CONSTRAINT "lti_links_context_id_lti_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."lti_contexts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_links" ADD CONSTRAINT "lti_links_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_platforms" ADD CONSTRAINT "lti_platforms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_states" ADD CONSTRAINT "lti_states_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_users" ADD CONSTRAINT "lti_users_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_users" ADD CONSTRAINT "lti_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lti_contexts_key" ON "lti_contexts" USING btree ("platform_id","context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_links_key" ON "lti_links" USING btree ("platform_id","resource_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_platforms_client" ON "lti_platforms" USING btree ("issuer","client_id");--> statement-breakpoint
CREATE INDEX "lti_users_user" ON "lti_users" USING btree ("user_id");