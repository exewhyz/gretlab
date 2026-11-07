-- Starter code is now the one place for the code students begin with. Driver code that
-- older problems kept separately is folded in after their starter, as the editor showed it.
UPDATE "problems"
SET "code" = (
  SELECT jsonb_object_agg(
    e.lang,
    CASE
      WHEN NOT (e.parts ? 'driver') THEN e.parts
      WHEN btrim(e.parts->>'driver', E' \n\t\r') = '' THEN e.parts - 'driver'
      WHEN btrim(coalesce(e.parts->>'starter', ''), E' \n\t\r') = '' THEN
        (e.parts - 'driver') || jsonb_build_object('starter', rtrim(e.parts->>'driver', E' \n\t\r') || E'\n')
      ELSE
        (e.parts - 'driver') || jsonb_build_object(
          'starter',
          rtrim(e.parts->>'starter', E' \n\t\r') || E'\n\n\n' || rtrim(e.parts->>'driver', E' \n\t\r') || E'\n'
        )
    END
  )
  FROM jsonb_each("code") AS e(lang, parts)
)
WHERE EXISTS (SELECT 1 FROM jsonb_each("code") AS e(lang, parts) WHERE e.parts ? 'driver');
