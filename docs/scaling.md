---
title: Scaling and operations
description: How Gretlab handles a class or a whole college, what was measured, and how to size and run a deployment.
---

How Gretlab handles a class or a whole college, what was measured, and how to size a deployment.

## Architecture

```
                    ┌────────────┐
 Browsers ── HTTPS ─▶ Caddy (LB) │  health checks, retries, least-connections
                    └─────┬──────┘
              ┌───────────┼───────────┐
          ┌───▼───┐   ┌───▼───┐   ┌───▼───┐
          │  web  │   │  web  │   │  web  │   stateless: add replicas freely
          └───┬───┘   └───┬───┘   └───┬───┘
              └───────────┼───────────┘
                    ┌─────▼─────┐
                    │ PgBouncer │   thousands of clients, a few dozen real connections
                    └─────┬─────┘
                    ┌─────▼─────┐
                    │ Postgres  │   the queue and all state
                    └─────▲─────┘
        ┌─────────────────┼─────────────────┐
   ┌────┴────┐       ┌────┴────┐       ┌────┴────┐
   │ runner  │       │ runner  │       │ runner  │   one per machine: add machines freely
   │ gVisor  │       │ gVisor  │       │ gVisor  │
   └─────────┘       └─────────┘       └─────────┘
```

Each tier scales on its own, and none depends on another being up to keep what it already has. If every runner stops, students can still read and write code, and their jobs wait in the queue.

## How it copes with load

| Problem | What handles it | Where |
| --- | --- | --- |
| A spike of runs | Postgres queue with `SKIP LOCKED`: runners never block each other or take the same job | `apps/runner/src/queue.ts` |
| Contest work during a backlog | A head start by kind (contest submit, then submit, then run). Only a head start, so runs can't starve | `packages/judge/src/queue.ts` |
| One student flooding the queue | Per-student limits, checked under a lock so parallel requests can't beat them | `features/submissions/server.ts` |
| More work than capacity | Load shedding: past the queue limit, Runs get a clear "busy, retry in 15 s". Submits are accepted up to twice that | `enforceCapacity` |
| Polling becoming the load | A light status endpoint; the server sets the pace, longer queues poll less, with random spread | `getSubmissionStatus` |
| A contest refreshing the leaderboard | Shared and cached for 5 s per replica; computed in linear time | `features/contests/server.ts` |
| Settings read on every request | Cached for 5 s per replica | `features/settings/server.ts` |
| A runner crashing | Short leases renewed by heartbeat; its jobs return within about 45 s. A job that keeps failing ends as a system error after 3 tries | `releaseExpired` |
| A late result after a lease lapsed | Ignored: only the current holder can record a result | `processSubmission` |
| Deploying a new runner | SIGTERM stops claiming and finishes running jobs | `apps/runner/src/main.ts` |
| A web replica dying | Load balancer health checks and retries | `deploy/Caddyfile` |
| The table growing forever | Old plain runs are deleted (setting). Partial indexes keep the queue fast regardless | `pruneOldRuns` |
| Too many database connections | PgBouncer in transaction mode | `docker-compose.prod.yml` |

## What was measured

All on one 10-core laptop, with the web tier, Postgres and the load generator **sharing those cores with the runners**, using real gVisor in nested Docker (slower than a real server). Each simulated student reads, presses Run or Submit (25% submits with 6 tests), waits, thinks, and repeats. "Think" is the average pause between runs.

| Scenario | Press Run to result, p50 / p95 | API p95 | Failures |
| --- | --- | --- | --- |
| 300 students, 45 s think, 1 runner | **0.32 s / 0.68 s** | 15 ms | 0 |
| 500 students, 60 s think, 1 runner | **0.57 s / 1.5 s** | 19 ms | 0 |
| 300 students, 20 s think (very active), 1 runner | 2.2 s / 7.4 s | 32 ms | 0 |
| Contest start: 300 at the same instant, 600 on the board, 30,000 submissions, 2 runners | 18 s / 30 s | 1.8 s | 0 |

The contest start is the hard case: 300 jobs at once is simply a backlog that takes time to clear at this laptop's capacity, and it's the case more runner machines address.

Before this work, 300 students at a 20 s think time on the original 2-slot runner waited **34 s / 49 s**, with polling at 256 requests a second.

Failure tests, under traffic:

| What was broken | Result |
| --- | --- |
| Runner killed with `kill -9`, holding 8 jobs | All 16 jobs finished correctly, in 43 s |
| Runner stopped gracefully during jobs | All finished; none retried |
| Web replica killed | 0 of 2,330 requests failed |
| Queue pushed past its limit | Runs refused with 503 and Retry-After; Submits accepted; recovered on its own |
| 30 parallel requests against a limit of 3 | Exactly 3 accepted |

### What limits a runner

Measured from inside the VM: throughput levels off at about 17 simple jobs a second from 4-8 parallel jobs, with or without gVisor, so the limit is CPU and the Docker daemon rather than gVisor itself. That's why slots default to at most 8 and capacity grows by adding machines. It's also why a warm container pool isn't built: it would reduce latency slightly, but not this limit.

### What this does not prove

- **Scale-out across machines hasn't been measured**, because that needs more than one machine. Two runners on the laptop added nothing, since they shared its CPU. The queue is built for it and tested for correctness under parallel claims, but measure it on your hardware.
- **Absolute numbers will differ on real servers.** Native gVisor on a Linux VM should do better than nested Docker on a laptop.

## Sizing

Work out your peak load:

```
jobs per second = active students / average seconds between runs
```

A lab of 300 students running every 45 s is about 7 jobs a second. A contest start can be several times that for a minute or two.

Plan on **about 1 job per second per CPU core** on runners. It's conservative, based on the laptop's roughly 8 jobs a second with everything sharing 10 cores. Then measure and adjust.

| Situation | Runners | Web | Postgres |
| --- | --- | --- | --- |
| One class, up to 100 students | 1 × 4 vCPU | 2 × 1 vCPU | 2 vCPU, 4 GB |
| A department, a few hundred at once | 1-2 × 16 vCPU | 3 × 2 vCPU | 4 vCPU, 8 GB |
| A college, or big contests | 3+ × 16 vCPU, scaled on queue depth | 4+ × 2 vCPU | 8 vCPU, 16 GB, with a standby |

Run `e2e/load.mjs` against your own deployment before a big event. Add runner machines ahead of a contest, because a burst arrives faster than a new machine can start.

## Deploy

1. **Postgres:** a managed instance with backups.
2. **Stateless tier**, on any Docker host:
   ```bash
   SITE_ADDRESS=lab.college.edu DB_HOST=... DB_PASSWORD=... \
   NEXTAUTH_URL=https://lab.college.edu NEXTAUTH_SECRET=... METRICS_TOKEN=... \
   docker compose -f docker-compose.prod.yml run --rm migrate
   # the same variables, then:
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml up -d --scale web=5   # to scale
   ```
3. **Runners**, one dedicated VM each, firewalled so they can reach only Postgres:
   ```bash
   # Install Docker and gVisor (https://gvisor.dev/docs/user_guide/install/), then:
   docker/sandbox/build.sh
   DATABASE_URL=postgres://... docker compose -f docker-compose.runner.yml up -d --build
   ```
   Connect runners directly to Postgres, not through PgBouncer: they're few, and wake-ups need a real session.

## Run it

- **Dashboard → Overview** shows queue depth, waits, slots in use and runners online, and warns when no runner is up or jobs are waiting too long.
- **`GET /api/health`** is for load balancers.
- **`GET /api/metrics`** gives Prometheus metrics with `Authorization: Bearer $METRICS_TOKEN`. Autoscale runners on `gretlab_queue_oldest_seconds`, and alert when `gretlab_runners_online` is 0.
- **Dashboard → Settings → Queue limit** sets when to start refusing Runs.

### Replicas and caching

Each web replica caches separately, which is what makes replicas simple to run. With more than one:

- A settings or language change reaches other replicas within **5 seconds**.
- A problem edit reaches other replicas' public pages within **60 seconds**.
- A leaderboard is at most **5 seconds** old.

If those delays ever matter, add a shared Next.js cache handler backed by Redis. Don't add one before then.

## Test it

```bash
e2e/stack.sh up 2                 # production shape locally: LB, 3 web, PgBouncer, 2 runners
node e2e/load.mjs --students=300 --seconds=60 --think=45 --base=http://localhost:8080
node e2e/resilience.mjs           # kills things on purpose
e2e/stack.sh down
```
