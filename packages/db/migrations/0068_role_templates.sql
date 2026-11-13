ALTER TABLE "org_kind_policies" ADD COLUMN "role_templates" jsonb;--> statement-breakpoint
ALTER TABLE "org_roles" ADD COLUMN "template_key" text;