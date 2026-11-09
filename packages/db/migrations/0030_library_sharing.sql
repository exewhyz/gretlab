CREATE TABLE "collection_items" (
	"collection_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_items_collection_id_item_type_item_id_pk" PRIMARY KEY("collection_id","item_type","item_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "sharing" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "copied_from" uuid;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "sharing" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "copied_from" uuid;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_shares" ADD CONSTRAINT "content_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_shares" ADD CONSTRAINT "content_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_shares" ADD CONSTRAINT "content_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_by_org" ON "collections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "content_shares_by_item" ON "content_shares" USING btree ("item_type","item_id");--> statement-breakpoint
-- Keep today's reach: colleges' own content stays theirs, unless it's already public.
UPDATE "problems" SET "sharing" = 'owner' WHERE "org_id" IS NOT NULL AND NOT ("published" AND "listed" AND NOT "members_only");--> statement-breakpoint
UPDATE "questions" SET "sharing" = 'owner' WHERE "org_id" IS NOT NULL;