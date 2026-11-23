# GretLab

A coding lab and LMS for colleges: practice problems, graded assignments and lab exams judged in a secure sandbox, quizzes, contests and courses, run by many colleges from one deployment.

**Start with [AGENTS.md](AGENTS.md).** It is the project's full context: architecture, every feature's rules and where its code lives, decisions and why, conventions, how to test, and the roadmap. AI assistants read it automatically (`CLAUDE.md` points to it).

- **Editor:** Monaco with multiple files and folders, highlighting, line numbers, formatting and completion.
- **Languages:** Python, JavaScript, C, C++ and Java.
- **Sandbox:** every run is a throwaway gVisor container with no network.
- **Colleges:** organizations with their own groups (year › branch › section, or anything), members, custom roles scoped to groups, invites, CSV and Excel import, reports and an activity log.
- **Classes:** a page per class with notices, classwork, a course, a discussion board, people, grades with early warnings, syllabus and attendance, and CO–PO outcomes.
- **Assignments and exams:** problems, quiz questions and GitHub projects; late penalties, extensions, rubrics, line comments, held results, peer code review; timed lab exams locked to lab networks; gradebooks with CSV.
- **Content once, used everywhere:** a shared library with collections and sharing between the platform and colleges; courses with module release rules; assignment and exam templates for many classes.
- **Contests:** registration, ICPC or IOI scoring, wrong-attempt penalties, scoreboard freeze, quiz questions.
- **Practice like LeetCode:** a problem library with tags and filters, a daily challenge with streaks, hints, editorials unlocked by solving, notes, lists and study plans, profiles and a leaderboard.
- **For students:** notifications (in-app and email), a calendar with a private iCal feed, certificates anyone can verify.
- **Notifications you control:** the platform decides what may be sent, each organization chooses within that, and each person chooses what reaches them by email. Teachers get a copy when a colleague publishes to their class; owners get a weekly summary.
- **Integration:** LTI 1.3 for Moodle, Canvas and other LMSs (sign-in, deep linking, grades back).
- **Integrity:** plagiarism checks that see through renamed variables and reformatting.

## Run it locally

Needs Node 20+, pnpm and Docker.

```bash
pnpm install
cp .env.example .env                      # uncomment the two runc lines, for local use only
cp apps/web/.env.example apps/web/.env.local
docker compose up -d --wait postgres
pnpm sandbox:images
pnpm db:migrate
pnpm db:seed
pnpm dev                                  # web on :3000, plus the runner
```

In `apps/web/.env.local`, set at least:

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=anything-long-for-local-use
ADMIN_EMAILS=you@example.com
AUTH_DEV_LOGIN=true        # sign in without Google; ignored in production builds
```

Open http://localhost:3000, sign in with `you@example.com`, and go to **Dashboard**. Docker's Postgres listens on port 5433; its data lives in a Docker volume, so it survives restarts (don't prune volumes).

## Go to production

Load balancer, web replicas and PgBouncer run from `docker-compose.prod.yml`, and each runner machine from `docker-compose.runner.yml`. The full guide, sizing table and measurements are in [docs/scaling.md](docs/scaling.md).

- **Runners must be dedicated machines**, with gVisor installed and firewalled so they reach only Postgres. A runner can start containers, so it must not share a machine with the web app or anything secret. It refuses to start without gVisor.
- **Google sign-in:** create an OAuth client with the redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`. It is the only sign-in method in production builds today.
- **First admin:** put your email in `ADMIN_EMAILS`, then sign in. Give platform staff their roles under **Dashboard → Staff and roles**.
- **Colleges:** one deployment serves many. Create each under **Dashboard → Organizations** and name its first owner, who runs it from **Manage** (members, groups, roles, teachers, settings, LMS). Restrict who can sign up with **Settings → Allowed email domains**.
- **Database:** run migrations (and the seed, the first time) before each release: `docker compose -f docker-compose.prod.yml run --rm migrate`, or `pnpm db:migrate` with `DATABASE_URL` set.

### The code judge (runner), on one command

Any fresh Ubuntu 22.04/24.04 server (2 vCPU, 4 GB is a good start) becomes a judge with:

```bash
curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/runner-setup.sh -o runner-setup.sh
sudo DATABASE_URL='postgres://user:password@host:port/db' bash runner-setup.sh
```

It installs Docker and gVisor, proves a container runs under gVisor, locks the firewall to SSH, builds the language images, creates the database tables (and loads the starter problems), runs the 16 hostile-program tests against the real sandbox, and only then starts the runner. Use the database's direct address, or a pooler in session mode (Supabase's port 5432), never transaction pooling: the runner keeps a `LISTEN` session open. Run it again to update; run it on more servers for more capacity. For an organization's own judge, run it on its own server with `RUNNER_POOL=<organization address>`: that organization's work then runs only there while it's online (falling back to the shared judges if none of its judges is online), and when it's idle it helps the shared judges. Keep the server for this alone (see AGENTS.md › Sandbox rules).

### How the live site runs (Vercel, Supabase, EC2)

The live site, https://gretlab.grettech.com, runs as three parts. The web app and the database are in Mumbai, beside the students; the judge is in Sydney (the AWS project's Region) and makes only a few queries per submission. Moved from Neon in Sydney on 22 November 2026 (`deploy/move-to-mumbai.md`).

Supabase addresses need `?sslmode=require` at the end (its Enforce SSL is on, and postgres.js doesn't ask for SSL by itself; without it: `ESSLREQUIRED`).

| Part | Where | Notes |
| --- | --- | --- |
| Web app (`apps/web`: the whole UI and API) | Vercel, project `gretlab-web`, Function Region `bom1` (Mumbai) | Deploys itself on every push to `main` |
| Postgres 17 | Supabase, Mumbai (`ap-south-1`) | Two addresses: the **transaction pooler** (port 6543) for Vercel, the **session pooler** (port 5432) for the judge, migrations and copies. The session pooler takes at most 15 connections; the judge uses 5 |
| Code judge (`apps/runner`) | AWS EC2 (`c7i-flex.large`, Ubuntu), set up by `deploy/runner-setup.sh` | gVisor sandboxes; firewall allows SSH only; `restart: always`, so it comes back after a reboot |

**Vercel settings** (Settings › Environment Variables, then Redeploy, because settings apply only to new deployments): `DATABASE_URL` (Supabase transaction pooler), `DATABASE_PREPARE=false` (required behind a pooler), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`, plus any optional settings below. The build reads the database too (it pre-renders `/problems`), and Turborepo passes only the settings listed in `turbo.json`, so add a new setting there as well (`passThroughEnv`).

**Google sign-in:** the OAuth client lists `https://gretlab.grettech.com` as a JavaScript origin and `https://gretlab.grettech.com/api/auth/callback/google` as the redirect URI. The consent screen must be published ("In production"); in testing mode, only listed test users can sign in.

**Releasing a change:**

1. If the change adds a migration, apply it first, from your machine, with Supabase's session pooler: `DATABASE_URL='<session pooler>?sslmode=require' pnpm db:migrate`. Write migrations the running site can live with (add columns and tables; rename or drop only in a later release), since the old version serves until Vercel switches over.
2. Push to `main`. Vercel builds and deploys the web app.
3. If the change touches the judge (`apps/runner`, `packages/judge`, `packages/db`, the sandbox images), update it on the server: `curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/runner-setup.sh -o /tmp/runner-setup.sh && sudo bash /tmp/runner-setup.sh`. It reuses the saved database address, migrates (skipped on the judges' own login), reruns the attack tests and restarts. Run a downloaded copy, not `/opt/gretlab/deploy/runner-setup.sh` (the script replaces that file as it runs), and don't pipe it into bash (docker reads the pipe).

**Judge machines from the dashboard** (Dashboard › Judges): set up once in AWS (Sydney) on 22 November 2026: the security group `gretlab-judge` (no inbound), the machine role `gretlab-judge-machine` (reads one SSM parameter), the launch template `gretlab-judge`, the OIDC provider for the Vercel team, and the website's role `gretlab-web-judges`. The database address for new machines is the SSM SecureString `/gretlab/judge/database-url` (the session pooler with `?sslmode=require`); change it there when the database moves. Vercel needs `JUDGES_AWS_ROLE_ARN` (the website role's ARN) in Production, and OIDC federation on (Team issuer). The policies and how to check them are in `deploy/aws/` (README there); the page's **Setup check** tries everything without starting a machine. **Automatic scaling** is off until switched on under Dashboard › Judges › Judge settings; it then starts and ends shared judges by itself within the running limit (AGENTS.md › Judge machines). **Dashboard › Monitoring** shows the queue, judges, email and webhooks and what's wrong now; **Dashboard › Costs** what dashboard machines cost this month. **Updating judges:** Dashboard › Judges › **Update** (or **Update all**) replaces each machine with a fresh one running `main`, one at a time; a judge set up by hand is still updated on its server (above). Machines started there show in the EC2 console as `gretlab-judge…`; a hand-set-up judge (like the first one) isn't tagged, so the website can never end it.

**The judges' own database login** (`gretlab_judge`, migrations 0081 and 0082). Judges run strangers' code, so they sign in with a login that can only judge: read and update the queue, read tests and settings, report themselves; never people, grades, sealed details or secrets, and never delete graded work. The migration makes the role without a password; give it one and switch the judges over once:

1. Migrate (`DATABASE_URL="<session pooler address>" pnpm db:migrate`), as for any release.
2. In Supabase's SQL editor, give the role a login, with a long random password of letters and digits (`openssl rand -hex 24` makes one; no symbols to escape in an address): `ALTER ROLE gretlab_judge WITH LOGIN PASSWORD '<password>';`
3. Its address is the session pooler's, with the user changed to `gretlab_judge.<project ref>` (the part after `postgres.` in the usual one): `postgres://gretlab_judge.<project ref>:<password>@<pooler host>:5432/postgres?sslmode=require`.
4. Put it in the SSM parameter, typing it at a prompt so it stays out of the shell history: `read -rs JUDGE_DB && aws ssm put-parameter --profile gretlab --region ap-southeast-2 --name /gretlab/judge/database-url --type SecureString --overwrite --value "$JUDGE_DB"; unset JUDGE_DB`.
5. Dashboard › Judges › **Update all**: each fresh machine signs in with the new address. A judge set up by hand: rerun `runner-setup.sh` on it with `DATABASE_URL='<the new address>'`.
6. Dashboard › Judges › Judges reporting in: every judge's **Database login** says "Its own (judging only)". "Main login" marks one still on the all-powerful one.

With this login, `runner-setup.sh` skips migrations and the starter problems: the owner runs those.

**Watching it:**

- Judge logs: `ssh ubuntu@<judge address>`, then `cd /opt/gretlab && sudo docker compose -f docker-compose.runner.yml logs -f runner`. A submission stuck at "queued" means the judge is down or can't reach the database.
- Costs: an AWS budget (`gretlab-monthly`, $20) emails at 50% and 100% of actual spend, and at a forecast above 100%.
- Background jobs (big exports and the like) move forward on their own: from the request that started them, whoever is watching their progress, the email cron and the uptime check. For jobs to start at once with nobody waiting, run the worker on any always-on server: `SITE_URL=https://gretlab.grettech.com CRON_SECRET=<the same as Vercel's> DATABASE_URL=<session pooler address> pnpm --filter worker start` (it only listens to the database and asks the site to run them). Monitoring shows how many are waiting.
- Alerts: anyone whose platform role has **Get monitoring alerts** (Owners do) is emailed when something on Dashboard › Monitoring goes wrong and again when it's fixed; Dashboard › Settings › Alerts switches them and sets a monthly judge cost limit. They're checked when the email cron runs and whenever `/api/health/judge` is called, so point an uptime monitor at it every minute (UptimeRobot, Better Stack and the like have free plans): that makes alerts prompt, and the monitor itself tells you if the site or email is down, which an email alert can't.
- Health: `GET /api/health` answers `{"status":"ok"}` while the website reaches the database (load balancers use it). `GET /api/health/judge` answers 200 while a code judge is online and no submission has waited over 3 minutes, and 503 with the reason otherwise.
- Uptime alerts: a free UptimeRobot (or similar) account watching both addresses every 5 minutes emails you when either goes down.

**Email:**

- Notifications are queued in Postgres (`email_outbox`) in the same transaction as the in-app ones, then sent right after the response, in batches of 100 through Resend's API, each with a key that stops duplicates.
- Failures retry after 1 min, 5 min, 30 min, 2 h and 6 h; a bad address fails alone without holding up the rest.
- Retries and very large batches are sent by `POST /api/cron/outbox` (`Authorization: Bearer <CRON_SECRET>`). Vercel calls it daily (`apps/web/vercel.json`, the most the Hobby plan allows), and `.github/workflows/email-outbox.yml` calls it every 15 minutes once the repository has the secret `CRON_SECRET` and the variable `SITE_URL`. On Vercel Pro, change the schedule in `vercel.json` to `* * * * *` instead.
- Vercel settings: `RESEND_API_KEY`, `MAIL_FROM` (on the domain verified in Resend) and `CRON_SECRET`. `SMTP_URL` isn't needed alongside the key.
- Watching it: `/api/metrics` reports `gretlab_mail_queued`, `gretlab_mail_oldest_seconds` and `gretlab_mail_failed_1d`; failures are logged as `[outbox]`.

**Lab exams limited to a network** work here with no setup: on Vercel the app trusts the visitor address Vercel's edge reports (`x-vercel-forwarded-for`), so `PROXY_SECRET` isn't needed. Don't put another proxy or CDN in front of the site, or every student will appear to come from it. On another host, set `CLIENT_IP_HEADER` to the header that host uses ([docs/deploy-exams.md](docs/deploy-exams.md)).

### Settings

The web app reads these (in development from `apps/web/.env.local`; in production from the host or the `.env` that `docker-compose.prod.yml` reads). Templates: [`apps/web/.env.example`](apps/web/.env.example) and [`.env.example`](.env.example).

| Setting | Needed | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection (web, runner, migrations) |
| `NEXTAUTH_URL` | yes | The site's public address; also used for links in email, calendar and LTI |
| `NEXTAUTH_SECRET` | yes | Signs session cookies: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes, in production | Google sign-in |
| `ADMIN_EMAILS` | yes | Comma-separated platform owners |
| `CLIENT_IP_HEADER` | for network-limited exams on hosts other than Vercel or Caddy | The header your host puts the visitor's address in, such as `cf-connecting-ip` ([docs/deploy-exams.md](docs/deploy-exams.md)) |
| `PROXY_SECRET` | for network-limited exams behind Caddy (not on Vercel) | Shared with Caddy so the app trusts visitors' addresses ([docs/deploy-exams.md](docs/deploy-exams.md)) |
| `RESEND_API_KEY` or `SMTP_URL`, and `MAIL_FROM` | no | Email notifications, queued and sent in batches with retries; without them, in-app only. Resend's API by default; `SMTP_URL` for any mail server |
| `CRON_SECRET` | with email | Lets a scheduler call `POST /api/cron/outbox` to send big batches and retries (see Email below) |
| `GITHUB_TOKEN` | no | Raises GitHub's limit for pinning project commits |
| `LTI_PRIVATE_KEY`, `LTI_KEY_ID` | no | A fixed LTI signing key; otherwise one is made and kept in the database |
| `METRICS_TOKEN` | no | Turns on `GET /api/metrics` |
| `NEXT_PUBLIC_ADSENSE_*` | no | Ads on public practice pages (see Ads) |
| `SANDBOX_RUNTIME`, `RUNNER_CONCURRENCY`, `RUNNER_MEMORY_MB` | runner | Sandbox runtime (`runsc` in production) and capacity |
| `AUTH_DEV_LOGIN`, `GITHUB_LOOKUP=off`, `LTI_ALLOW_HTTP` | development and tests only | Sign-in without Google, skipping GitHub lookups, http LMS addresses |

## Add things

| To add | Do this |
| --- | --- |
| A switch or setting | Add it to `packages/judge/src/features.ts`. It appears in the dashboard automatically. Enforce it on the server with `requireFeature()` or `getSettings()` |
| A language | Add it to `packages/judge/src/languages.ts` and `docker/sandbox/<id>/Dockerfile`, then `pnpm sandbox:images` |
| A table or column | Edit `packages/db/src/schema.ts`, then `pnpm db:generate` and `pnpm db:migrate` |
| An API endpoint | Create `apps/web/app/api/v1/<path>/route.ts` using `route()`, with the logic in `features/<name>/server.ts` |

## Layout

| Path | What it is |
| --- | --- |
| `apps/web/app/api/v1` | The REST API. There are no server actions |
| `apps/web/features` | One folder per feature: UI and `server.ts` |
| `apps/runner` | Queue worker and sandbox (`src/sandbox/docker.ts`) |
| `packages/db` | Drizzle schema, migrations, seed |
| `packages/judge` | Languages, settings, verdicts, leaderboard, file validation |
| `packages/ui` | Design tokens and shared components |
| `docker/sandbox` | One image per language |
| `e2e` | Whole-system tests (`run.sh`), load and failure tests |
| `docs` | Problem and question import formats, exam deployment, scaling |
| `deploy`, `docker-compose.*.yml` | Production deployment |

## Styling

Tailwind utilities by default, using the tokens (`bg-canvas`, `text-body`, `text-display-md`). SCSS modules are for what utilities handle badly: the workbench grid, drag handles and problem text.

- Tailwind v4 can't be processed through Sass, so `@apply` and `theme()` don't belong in `.scss` files. Read tokens as CSS variables, such as `var(--radius-lg)`.
- A new `--text-*` token must also be added to `packages/ui/src/lib/utils.ts`, or `cn()` will mistake it for a color and drop it.
- The design tokens live in `packages/ui/src/styles/globals.css`: a warm cream canvas, warm ink, one orange accent for primary actions, and hairlines instead of shadows.
- Dark mode follows the system until someone picks a theme. The `.dark` palette is the same warm hues inverted. Use tokens rather than fixed colors, and both themes work.

## Ads

With no configuration the site has no ads and loads no ad scripts. Ads appear only on public practice pages, and can be switched off under **Settings**.

1. Sign up for AdSense with the deployed domain, then set `NEXT_PUBLIC_ADSENSE_CLIENT`. This adds the ownership tag and `/ads.txt`. Redeploy and request review.
2. Once approved, create the three display units listed in `apps/web/.env.example`, set their slot ids and redeploy.
3. In AdSense, **turn Auto ads off** for the site. They bypass the limits in `apps/web/features/ads/config.ts`.
4. In **Privacy & messaging**, publish the GDPR consent message.
5. Have the site owner review `apps/web/app/privacy/page.tsx`.

## Test

```bash
pnpm test        # unit tests of the pure rules (packages/judge)
pnpm typecheck
pnpm test:e2e    # everything, about 40 minutes; needs Docker, sandbox images, ~10 GB free disk and: pnpm exec playwright install chromium
```

Each feature has its own browser and API suite in `e2e/` (listed in AGENTS.md › Testing), and any one can run against your dev server. Load and failure tests are described in [docs/scaling.md](docs/scaling.md).
