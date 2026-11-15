CREATE TABLE "problem_slug_history" (
	"slug" text PRIMARY KEY NOT NULL,
	"problem_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "problem_slug_history" ADD CONSTRAINT "problem_slug_history_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_slug_history_problem_idx" ON "problem_slug_history" USING btree ("problem_id");
--> statement-breakpoint
-- Data: the platform's numbered problems (p1, p2…) get readable slugs from their titles; the
-- old ones stay in problem_slug_history (src/readable-slugs.ts runs the same for fresh databases).
DO $$
DECLARE
  r record;
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN
    SELECT id, slug, title FROM problems
    WHERE org_id IS NULL AND slug ~ '^p[0-9]+$'
    ORDER BY (substring(slug from 2))::int
  LOOP
    base := left(trim(both '-' from regexp_replace(lower(r.title), '[^a-z0-9]+', '-', 'g')), 63);
    base := trim(both '-' from base);
    CONTINUE WHEN base = '';
    candidate := base;
    n := 2;
    -- 'topics' is the topic pages' address (/problems/topics), never a problem's.
    WHILE candidate = 'topics'
       OR EXISTS (SELECT 1 FROM problems WHERE slug = candidate)
       OR EXISTS (SELECT 1 FROM problem_slug_history WHERE slug = candidate) LOOP
      candidate := left(base, 60) || '-' || n;
      n := n + 1;
    END LOOP;
    INSERT INTO problem_slug_history (slug, problem_id) VALUES (r.slug, r.id)
      ON CONFLICT (slug) DO NOTHING;
    UPDATE problems SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;
