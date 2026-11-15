/*
 * Gives the platform's problems still addressed by number (`p2`, the original content's ids)
 * readable slugs from their titles (`integer-operations`), keeping the old one in
 * problem_slug_history so links, saved progress and API callers still find them. The slug
 * is made the way the app's slugify() makes it; a slug already taken gets -2, -3….
 * Safe to run again: only number-addressed problems change. Migration 0071 runs the same
 * SQL on existing databases; the seed runs this after importing (fresh databases).
 */
export const READABLE_SLUGS_SQL = `DO $$
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
END $$;`
