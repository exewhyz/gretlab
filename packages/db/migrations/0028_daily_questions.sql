CREATE TABLE "daily_questions" (
	"day" text NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_questions_day_question_id_pk" PRIMARY KEY("day","question_id")
);
--> statement-breakpoint
ALTER TABLE "daily_challenges" DROP CONSTRAINT "daily_challenges_question_id_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_answers" DROP CONSTRAINT "daily_answers_day_user_id_pk";--> statement-breakpoint
ALTER TABLE "daily_answers" ADD CONSTRAINT "daily_answers_day_user_id_question_id_pk" PRIMARY KEY("day","user_id","question_id");--> statement-breakpoint
ALTER TABLE "daily_questions" ADD CONSTRAINT "daily_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Days that had one question keep it as their first.
INSERT INTO "daily_questions" ("day", "question_id", "position")
SELECT "day", "question_id", 0 FROM "daily_challenges" WHERE "question_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_challenges" DROP COLUMN "question_id";