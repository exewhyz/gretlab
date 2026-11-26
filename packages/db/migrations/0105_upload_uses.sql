CREATE TABLE "upload_uses" (
	"upload_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_uses_upload_id_user_id_pk" PRIMARY KEY("upload_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "upload_uses" ADD CONSTRAINT "upload_uses_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_uses" ADD CONSTRAINT "upload_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_uses_by" ON "upload_uses" USING btree ("user_id","last_used_at");--> statement-breakpoint
-- Every image already uploaded is in its uploader's library.
INSERT INTO "upload_uses" ("upload_id", "user_id", "created_at", "last_used_at")
SELECT "id", "uploaded_by", "created_at", "created_at" FROM "uploads" WHERE "uploaded_by" IS NOT NULL
ON CONFLICT DO NOTHING;
