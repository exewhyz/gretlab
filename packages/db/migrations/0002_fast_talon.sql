ALTER TABLE "submissions" ADD COLUMN "run_cases" jsonb;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "runtime_ms" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "memory_kb" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "passed_tests" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "total_tests" integer;--> statement-breakpoint
CREATE INDEX "submissions_kind_created" ON "submissions" USING btree ("kind","created_at");--> statement-breakpoint
-- Plain runs were never compared with anything, so they were never really "Accepted".
UPDATE "submissions" SET "verdict" = 'OK' WHERE "kind" = 'run' AND "verdict" = 'AC';--> statement-breakpoint
UPDATE "submissions" s SET
  "runtime_ms" = r.runtime, "memory_kb" = r.memory, "passed_tests" = r.passed, "total_tests" = r.total
FROM (
  SELECT id,
    (SELECT max((c->>'wallMs')::int) FROM jsonb_array_elements(results) c) AS runtime,
    (SELECT max((c->>'maxRssKb')::int) FROM jsonb_array_elements(results) c) AS memory,
    (SELECT count(*) FROM jsonb_array_elements(results) c WHERE c->>'verdict' = 'AC') AS passed,
    jsonb_array_length(results) AS total
  FROM "submissions" WHERE results IS NOT NULL AND jsonb_typeof(results) = 'array'
) r WHERE s.id = r.id;
