# Moving the live site's database to Mumbai (Neon → Supabase)

Why: students are in India, but the web app and database run in Sydney. Every request from India
travels to Sydney and back (about 300 ms, measured 21 November 2026: `x-vercel-id: bom1::syd1`),
and a page change makes several. Neon has no region in India; Supabase has Mumbai
(`ap-south-1`). The web app moves with the database, because one page makes many queries and
the function must sit beside the database. The code judge stays on EC2 in Sydney (the AWS
project's Region); it makes only a few queries per submission.

You run every step that touches production. Nothing here needs a code change: the app speaks
plain Postgres. Time needed: an evening for the rehearsal, under an hour for the cutover.

Throughout, keep database addresses out of chat, commits and shell scripts. Paste them into
environment variables only (`export NEON_URL='…'`), in a terminal you close afterwards.

## The three addresses

Supabase's **Connect** button shows them. Use each only where it says.

| Address | Port | Mode | Used by |
| --- | --- | --- | --- |
| Transaction pooler, `aws-…-ap-south-1.pooler.supabase.com` | 6543 | transaction | Vercel (`DATABASE_URL`, with `DATABASE_PREPARE=false`, as with Neon) |
| Session pooler, same host | 5432 | session | The judge (it keeps a `LISTEN` session), migrations, the copy (`pg_dump`/`pg_restore`) |
| Direct, `db.<project>.supabase.co` | 5432 | none | Not needed. It's IPv6-only unless you buy the IPv4 add-on; the session pooler does the same job over IPv4 |

## 1. Before you start

1. **Look at the current database.** In Neon's SQL editor:
   ```sql
   select version(), pg_size_pretty(pg_database_size(current_database()));
   ```
   Note the major version (for example 17) and the size. The copy takes roughly a minute per
   few hundred MB each way.
2. **Supabase plan.** Use a paid plan for production. Free projects pause when idle and have a
   small database limit. Check the current prices on Supabase's pricing page.
3. **Create the production project:**
   - Region: **South Asia (Mumbai)**.
   - Postgres version: the same as Neon's or newer, never older.
   - A long generated database password, kept in your password manager.
   - If the form offers **Enable Data API**, turn it off. GretLab doesn't use it.
4. **Lock it down** (Supabase would otherwise let its public REST API reach tables in `public`):
   - Project Settings › Data API: turn the Data API off, or remove `public` from the exposed
     schemas.
   - Database › Settings: **Enforce SSL** on.
   - SQL editor, run:
     ```sql
     revoke usage on schema public from anon, authenticated;
     revoke all on all tables in schema public from anon, authenticated;
     revoke all on all sequences in schema public from anon, authenticated;
     revoke all on all functions in schema public from anon, authenticated;
     alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
     alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
     alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
     ```
5. **Tools:** Docker on your Mac. `pg_dump`, `pg_restore` and `psql` come from the
   `postgres:18` image, so nothing else to install. The image must match Neon's major version
   (18, checked 21 November 2026): an older `pg_dump` refuses a newer server.

## 2. Rehearse (a day or more before, no downtime)

The rehearsal proves the copy works and tells you how long it takes. It uses a **second,
throwaway Supabase project** (the free plan is fine), never the production one.

1. Create the throwaway project in Mumbai, same Postgres version, and lock it down exactly as in
   step 1.4. It will hold real people's data, so treat it like production.
2. In a terminal, in an empty folder:
   ```bash
   export NEON_URL='<Neon direct address>'
   export TARGET_URL='<throwaway project, session pooler, port 5432>'
   time docker run --rm -v "$PWD":/work -e NEON_URL postgres:18 \
     pg_dump "$NEON_URL" --format=custom --no-owner --no-acl \
       --schema=public --schema=drizzle --file=/work/gretlab.dump
   time docker run --rm -v "$PWD":/work -e TARGET_URL postgres:18 \
     pg_restore --dbname="$TARGET_URL" --no-owner --no-acl /work/gretlab.dump
   ```
   **Inside the container, the variables are written as `"$NEON_URL"`; type them exactly
   so.** `pg_restore` may report an error about the `public` schema already existing or its
   comment; that one is harmless. Any other error: stop and look before going further.
3. Compare:
   ```bash
   OLD_URL="$NEON_URL" NEW_URL="$TARGET_URL" bash <repo>/deploy/compare-databases.sh
   ```
   A few busy tables (submissions, drafts, notifications) may differ because the live site kept
   writing during the copy. Everything else should match.
4. Check the grants are gone (should return no rows):
   ```sql
   select grantee, count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') group by 1;
   ```
5. Try the app against it from your Mac. Use another port; never stop your own dev server:
   ```bash
   cd <repo>
   DATABASE_URL='<throwaway transaction pooler, port 6543>' DATABASE_PREPARE=false \
     pnpm --filter web exec next dev -p 3001
   ```
   Open http://localhost:3001, sign in with a password account, open the library, a problem,
   an organization home and the dashboard. Submissions stay queued (no judge points at it);
   that's expected.
6. Note how long the dump and restore took. That's the length of the cutover's quiet window.
7. **Clean up:** delete the throwaway project, and delete `gretlab.dump`. It holds everyone's
   data.

## 3. Cut over

Choose a quiet hour (late night, India time), with no exam sitting or contest running or
starting soon (Dashboard › Assignments and Contests). Tell teachers beforehand: for the few
minutes of the copy, pages open but nothing saves (no submissions, drafts or sign-ups).

The rehearsal's copy is thrown away. This copy is taken fresh from Neon now, so everything people
did up to this moment comes across. Freezing Neon first means nothing written during the copy
is left behind.

1. **Stop the judge**, so nothing is judged twice:
   ```bash
   ssh ubuntu@<judge address>
   cd /opt/gretlab && sudo docker compose -f docker-compose.runner.yml stop runner
   ```
   Queued submissions stay in the database and are copied with it.
2. **Freeze Neon** (read only), in Neon's SQL editor:
   ```sql
   do $$ begin
     execute format('alter database %I set default_transaction_read_only = on', current_database());
   end $$;
   -- Close open connections, so they reconnect read-only:
   select count(pg_terminate_backend(pid)) from pg_stat_activity
   where datname = current_database() and pid <> pg_backend_pid();
   ```
   Check it took: open a new SQL editor tab and run
   `show default_transaction_read_only;`. It should say `on`. From now on any save on the live
   site fails with an error, and reading still works.
3. **Copy**, exactly as in the rehearsal, into the **production** Supabase project (session
   pooler, port 5432). `pg_dump` only reads, so the freeze doesn't stop it.
4. **Compare** with `deploy/compare-databases.sh`. With Neon frozen, **every table must match**
   (it prints "Every table matches."). If one differs, something got written before the freeze
   took. Don't go on: check the freeze (step 2), then copy again into a new, empty Supabase
   project (steps 1.3 and 1.4); the address changes, which doesn't matter yet.
5. **Check the grants** (step 2.4) on the production project.
6. **Point Vercel at it.** Project `web` › Settings:
   - Environment Variables (Production): `DATABASE_URL` = the production **transaction pooler**
     (port 6543). Keep `DATABASE_PREPARE=false`.
   - Functions › Function Region: **Mumbai, India (bom1)**, in place of Sydney.
   - Deployments › the latest production deployment › **Redeploy**. Settings only apply to new
     deployments.
7. **Point the judge at it** (this also pulls the latest judge code from `main`):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/runner-setup.sh -o /tmp/runner-setup.sh
   sudo DATABASE_URL='<production session pooler, port 5432>' SEED=0 bash /tmp/runner-setup.sh
   ```
   `SEED=0` matters: without it the script loads the starter problems over real data. The
   script migrates (nothing to do), reruns the sandbox attack tests and starts the judge.

## 4. Check it worked

```bash
curl -sI https://gretlab.grettech.com/api/health | grep -i x-vercel-id      # bom1::bom1
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{time_total}\n" https://gretlab.grettech.com/api/health
done                                                                          # was ~0.3 s
curl -s https://gretlab.grettech.com/api/health/judge                         # 200, a judge online
```

Then in a browser: sign in with Google, open a problem, press Run and Submit, and see both come
back. Open an organization home and the dashboard. Check the judge log shows no errors:
`sudo docker compose -f docker-compose.runner.yml logs --tail 50 runner`.

## 5. If something goes wrong

Within the first hours, going back is quick:

1. Unfreeze Neon, in its SQL editor (the `begin read write` is needed: the frozen database
   refuses even this otherwise):
   ```sql
   begin read write;
   do $$ begin
     execute format('alter database %I reset default_transaction_read_only', current_database());
   end $$;
   commit;
   select count(pg_terminate_backend(pid)) from pg_stat_activity
   where datname = current_database() and pid <> pg_backend_pid();
   ```
2. Vercel: `DATABASE_URL` back to Neon's pooled address, Function Region back to Sydney, Redeploy.
3. Judge: `sudo DATABASE_URL='<Neon direct address>' SEED=0 bash /tmp/runner-setup.sh`.

Anything written to Supabase after the cutover isn't on Neon. The longer you wait, the more
that is, so decide early. Leave Neon frozen and untouched for a week: frozen, nothing can write to
it by mistake (an old deployment, a forgotten script), and with nothing connected it sleeps and
costs little.

## 6. Afterwards

- After a quiet week: delete the Neon project, and any copy of `gretlab.dump`.
- Migrations from now on use the Supabase **session pooler** address:
  `DATABASE_URL='<session pooler, port 5432>' pnpm db:migrate`.
- Ask Claude, the same day, to update the privacy policy (it names Neon as the database and
  says the website runs in Australia: `features/legal/components/privacy-policy.tsx`, with
  `LEGAL_UPDATED` bumped), README › How the live site runs, and AGENTS.md (the Shipped
  paragraph) to Supabase, Mumbai and the new addresses. The policy must stay true, so this
  ships right after the cutover, not before.
- Uptime monitoring and the AWS budget alarm stay as they are.
