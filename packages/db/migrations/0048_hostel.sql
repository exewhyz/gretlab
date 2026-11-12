CREATE TABLE "hostel_beds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hostel_residents" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bed_id" uuid NOT NULL,
	"since" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hostel_residents_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hostel_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"floor" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hostels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"for_whom" text DEFAULT '' NOT NULL,
	"warden" text DEFAULT '' NOT NULL,
	"warden_phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hostel_beds" ADD CONSTRAINT "hostel_beds_room_id_hostel_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."hostel_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_residents" ADD CONSTRAINT "hostel_residents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_residents" ADD CONSTRAINT "hostel_residents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_residents" ADD CONSTRAINT "hostel_residents_bed_id_hostel_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "public"."hostel_beds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_hostel_id_hostels_id_fk" FOREIGN KEY ("hostel_id") REFERENCES "public"."hostels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hostel_beds_label" ON "hostel_beds" USING btree ("room_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "hostel_residents_bed" ON "hostel_residents" USING btree ("bed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hostel_rooms_name" ON "hostel_rooms" USING btree ("hostel_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "hostels_name" ON "hostels" USING btree ("org_id","name");