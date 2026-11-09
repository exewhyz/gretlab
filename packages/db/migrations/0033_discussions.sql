CREATE TABLE "discussion_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"answer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discussion_votes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "discussion_votes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_group_id_org_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."org_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_parent_id_discussion_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."discussion_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_votes" ADD CONSTRAINT "discussion_votes_post_id_discussion_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."discussion_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_votes" ADD CONSTRAINT "discussion_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discussion_threads" ON "discussion_posts" USING btree ("group_id","activity_at");--> statement-breakpoint
CREATE INDEX "discussion_replies" ON "discussion_posts" USING btree ("parent_id","created_at");