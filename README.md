# Gretlab

A coding lab for a teacher or college: practice problems, graded submissions in a secure sandbox, and contests, all configured from a dashboard. Design and security decisions are in [AGENTS.md](AGENTS.md).

- **Editor:** Monaco with multiple files and folders, highlighting, line numbers, formatting and completion.
- **Languages:** Python, JavaScript, C, C++ and Java.
- **Sandbox:** every run is a throwaway gVisor container with no network.
- **Dashboard:** settings and feature switches, language limits, problems and hidden tests, users and roles, contests, live submissions.
- **Contests:** registration, ICPC or IOI scoring, wrong-attempt penalties, scoreboard freeze.
- **Practice like LeetCode:** a problem library with topic tags, filters and acceptance rates; a daily challenge with streaks; hints; editorials unlocked by solving; private notes; favorites, lists and teacher-made study plans; profiles with an activity heatmap and badges; a leaderboard.
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

Open http://localhost:3000, sign in with `you@example.com`, and go to **Dashboard**.

## Go to production

Load balancer, web replicas and PgBouncer run from `docker-compose.prod.yml`, and each runner machine from `docker-compose.runner.yml`. The full guide, sizing table and measurements are in [docs/scaling.md](docs/scaling.md).

- **Runners must be dedicated machines**, with gVisor installed and firewalled so they reach only Postgres. A runner can start containers, so it must not share a machine with the web app or anything secret. It refuses to start without gVisor.
- **Google sign-in:** create an OAuth client with the redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`.
- **First admin:** put your email in `ADMIN_EMAILS`, then sign in. Promote teachers under **Dashboard → Users**.

For another college, deploy another copy with its own database. Restrict sign-ups with **Settings → Allowed email domains**.

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
| `e2e` | Whole-system, load and failure tests |
| `deploy`, `docker-compose.*.yml` | Production deployment |

## Styling

Tailwind utilities by default, using the tokens (`bg-canvas`, `text-body`, `text-display-md`). SCSS modules are for what utilities handle badly: the workbench grid, drag handles and problem text.

- Tailwind v4 can't be processed through Sass, so `@apply` and `theme()` don't belong in `.scss` files. Read tokens as CSS variables, such as `var(--radius-lg)`.
- A new `--text-*` token must also be added to `packages/ui/src/lib/utils.ts`, or `cn()` will mistake it for a color and drop it.
- The timeline pastels in `cursor.design.md` are reserved for agent timelines, so they aren't tokens here.
- Dark mode follows the system until someone picks a theme. `cursor.design.md` is light only, so the `.dark` palette in `globals.css` is derived from it. Use tokens rather than fixed colors, and both themes work.

## Ads

With no configuration the site has no ads and loads no ad scripts. Ads appear only on public practice pages, and can be switched off under **Settings**.

1. Sign up for AdSense with the deployed domain, then set `NEXT_PUBLIC_ADSENSE_CLIENT`. This adds the ownership tag and `/ads.txt`. Redeploy and request review.
2. Once approved, create the three display units listed in `apps/web/.env.example`, set their slot ids and redeploy.
3. In AdSense, **turn Auto ads off** for the site. They bypass the limits in `apps/web/features/ads/config.ts`.
4. In **Privacy & messaging**, publish the GDPR consent message.
5. Have the site owner review `apps/web/app/privacy/page.tsx`.

## Test

```bash
pnpm test        # unit tests
pnpm test:e2e    # needs Docker, sandbox images and: pnpm exec playwright install chromium
```

Load and failure tests are described in [docs/scaling.md](docs/scaling.md).
