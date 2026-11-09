CREATE TABLE "course_classes" (
	"course_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"starts_on" text NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_classes_course_id_group_id_pk" PRIMARY KEY("course_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "course_items" (
	"module_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "course_items_module_id_item_type_item_id_pk" PRIMARY KEY("module_id","item_type","item_id")
);
--> statement-breakpoint
CREATE TABLE "course_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"open_after_days" integer,
	"after_previous" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"sharing" text DEFAULT 'owner' NOT NULL,
	"copied_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_answers" (
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"correct" boolean NOT NULL,
	"tries" integer DEFAULT 1 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_answers_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_group_id_org_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."org_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_items" ADD CONSTRAINT "course_items_module_id_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_classes_by_group" ON "course_classes" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "course_items_by_item" ON "course_items" USING btree ("item_type","item_id");--> statement-breakpoint
CREATE INDEX "course_modules_by_course" ON "course_modules" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "courses_by_org" ON "courses" USING btree ("org_id");--> statement-breakpoint
-- The platform's units become its first course: one module per unit, its public problems in order.
INSERT INTO "courses" ("id", "org_id", "title", "description", "published", "sharing")
SELECT gen_random_uuid(), NULL, 'Programming fundamentals', 'The platform''s library outline, unit by unit.', true, 'everyone'
WHERE EXISTS (SELECT 1 FROM "units") AND NOT EXISTS (SELECT 1 FROM "courses" WHERE "org_id" IS NULL);
--> statement-breakpoint
INSERT INTO "course_modules" ("course_id", "title", "position")
SELECT c."id", u."name", u."position"
FROM "units" u CROSS JOIN (SELECT "id" FROM "courses" WHERE "org_id" IS NULL AND "title" = 'Programming fundamentals' LIMIT 1) c
WHERE NOT EXISTS (SELECT 1 FROM "course_modules" m WHERE m."course_id" = c."id");
--> statement-breakpoint
INSERT INTO "course_items" ("module_id", "item_type", "item_id", "position")
SELECT m."id", 'problem', p."id", p."position"
FROM "problems" p
JOIN "units" u ON u."id" = p."unit_id"
JOIN "course_modules" m ON m."title" = u."name" AND m."position" = u."position"
JOIN "courses" c ON c."id" = m."course_id" AND c."org_id" IS NULL AND c."title" = 'Programming fundamentals'
WHERE p."published" AND p."listed" AND NOT p."members_only"
ON CONFLICT DO NOTHING;
