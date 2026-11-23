-- The judges' own database login, holding only what judging needs (AGENTS.md › Judge login).
-- Judges run strangers' code, so a judge machine is the likeliest to be taken over; whoever
-- takes one gets a queue, not the people, grades or secrets.
--
-- The role is made without a login or password: the operator gives it one on the server
-- (ALTER ROLE gretlab_judge WITH LOGIN PASSWORD '…'), so no password is ever in the code.
-- Safe to run again: roles belong to the whole server, so another database there may have made it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gretlab_judge') THEN
    CREATE ROLE gretlab_judge NOLOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO gretlab_judge', current_database());
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO gretlab_judge;
--> statement-breakpoint
-- The queue. Reading a claimed job returns its whole row; the judge changes only its progress
-- and result, never who sent it, what or for which problem.
GRANT SELECT, DELETE ON submissions TO gretlab_judge;
--> statement-breakpoint
GRANT UPDATE (
  status, provisional, rejudges, verdict, score, max_score, compile_output, results,
  runtime_ms, memory_kb, passed_tests, total_tests, queue_at, attempts, locked_by,
  locked_until, started_at, finished_at
) ON submissions TO gretlab_judge;
--> statement-breakpoint
-- Deleting is for old plain runs only: graded submissions are the record. Row security binds
-- only the judge: the app's login owns the table (row security doesn't apply to an owner), and
-- `everyone_else` keeps any other login exactly as it was, whatever it was granted.
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS everyone_else ON submissions;
--> statement-breakpoint
CREATE POLICY everyone_else ON submissions FOR ALL TO PUBLIC
  USING (current_user <> 'gretlab_judge') WITH CHECK (current_user <> 'gretlab_judge');
--> statement-breakpoint
DROP POLICY IF EXISTS judge_reads ON submissions;
--> statement-breakpoint
CREATE POLICY judge_reads ON submissions FOR SELECT TO gretlab_judge USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS judge_judges ON submissions;
--> statement-breakpoint
CREATE POLICY judge_judges ON submissions FOR UPDATE TO gretlab_judge USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS judge_prunes_runs ON submissions;
--> statement-breakpoint
CREATE POLICY judge_prunes_runs ON submissions FOR DELETE TO gretlab_judge USING (kind = 'run');
--> statement-breakpoint
-- Who is judging: its own row, and clearing judges that stopped reporting.
GRANT SELECT, INSERT, UPDATE, DELETE ON runners TO gretlab_judge;
--> statement-breakpoint
-- What to judge with: the tests, and the platform's settings.
GRANT SELECT ON test_cases, settings TO gretlab_judge;
--> statement-breakpoint
-- Whose work it is (its pool, and where an organization's code may run), never anything else.
GRANT SELECT (id, slug, execution) ON organizations TO gretlab_judge;
--> statement-breakpoint
GRANT SELECT (id, org_id) ON problems TO gretlab_judge;
--> statement-breakpoint
GRANT SELECT (id, org_id) ON contests TO gretlab_judge;
--> statement-breakpoint
-- A dashboard machine: whether it's asked to drain, and saying how setting up and draining went.
GRANT SELECT (instance_id, stage) ON judge_machines TO gretlab_judge;
--> statement-breakpoint
GRANT UPDATE (stage, note, stage_at) ON judge_machines TO gretlab_judge;
