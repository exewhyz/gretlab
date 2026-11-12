CREATE TABLE "staff_attendance" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"status" text NOT NULL,
	"check_in" text,
	"note" text DEFAULT '' NOT NULL,
	"marked_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_attendance_org_id_user_id_day_pk" PRIMARY KEY("org_id","user_id","day")
);
--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_attendance_day" ON "staff_attendance" USING btree ("org_id","day");