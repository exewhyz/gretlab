# Gretlab

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

It installs Docker and gVisor, proves a container runs under gVisor, locks the firewall to SSH, builds the language images, creates the database tables (and loads the starter problems), runs the 16 hostile-program tests against the real sandbox, and only then starts the runner. Use the database's direct address, not a pooler. Run it again to update; run it on more servers for more capacity. Keep the server for this alone (see AGENTS.md › Sandbox rules).

### How the live site runs (Vercel, Neon, EC2)

The live site, https://gretlab.grettech.com, runs as three parts, all in Sydney (`ap-southeast-2`):

| Part | Where | Notes |
| --- | --- | --- |
| Web app (`apps/web`: the whole UI and API) | Vercel, project `web`, Function Region `syd1` | Deploys itself on every push to `main` |
| Postgres | Neon | Two addresses: the **pooled** one (host contains `-pooler`) for Vercel, the **direct** one for the judge and migrations |
| Code judge (`apps/runner`) | AWS EC2 (`c7i-flex.large`, Ubuntu), set up by `deploy/runner-setup.sh` | gVisor sandboxes; firewall allows SSH only; `restart: always`, so it comes back after a reboot |

**Vercel settings** (Settings › Environment Variables, then Redeploy, because settings apply only to new deployments): `DATABASE_URL` (Neon pooled), `DATABASE_PREPARE=false` (required behind a pooler), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`, plus any optional settings below. The build reads the database too (it pre-renders `/problems`), and Turborepo passes only the settings listed in `turbo.json`, so add a new setting there as well (`passThroughEnv`).

**Google sign-in:** the OAuth client lists `https://gretlab.grettech.com` as a JavaScript origin and `https://gretlab.grettech.com/api/auth/callback/google` as the redirect URI. The consent screen must be published ("In production"); in testing mode, only listed test users can sign in.

**Releasing a change:**

1. If the change adds a migration, apply it first, from your machine, with Neon's direct address: `DATABASE_URL='<direct>' pnpm db:migrate`. Write migrations the running site can live with (add columns and tables; rename or drop only in a later release), since the old version serves until Vercel switches over.
2. Push to `main`. Vercel builds and deploys the web app.
3. If the change touches the judge (`apps/runner`, `packages/judge`, `packages/db`, the sandbox images), update it on the server: `curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/runner-setup.sh -o /tmp/runner-setup.sh && sudo bash /tmp/runner-setup.sh`. It reuses the saved database address, migrates, reruns the attack tests and restarts. Run a downloaded copy, not `/opt/gretlab/deploy/runner-setup.sh` (the script replaces that file as it runs), and don't pipe it into bash (docker reads the pipe).

**Watching it:**

- Judge logs: `ssh ubuntu@<judge address>`, then `cd /opt/gretlab && sudo docker compose -f docker-compose.runner.yml logs -f runner`. A submission stuck at "queued" means the judge is down or can't reach Neon.
- Costs: an AWS budget (`gretlab-monthly`, $20) emails at 50% and 100% of actual spend, and at a forecast above 100%. Neon's compute stays awake, because the judge keeps a `LISTEN` connection open.
- Health: `GET /api/health` answers `{"status":"ok"}`.

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
| `SMTP_URL`, `MAIL_FROM` | no | Email notifications; without them, in-app only |
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
