CREATE TABLE "library_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"isbn" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"shelf" text DEFAULT '' NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"issued_on" text NOT NULL,
	"due_on" text NOT NULL,
	"returned_on" text,
	"status" text DEFAULT 'out' NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_book_id_library_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."library_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_books_org" ON "library_books" USING btree ("org_id","title");--> statement-breakpoint
CREATE INDEX "library_loans_org" ON "library_loans" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "library_loans_user" ON "library_loans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_loans_book" ON "library_loans" USING btree ("book_id","status");