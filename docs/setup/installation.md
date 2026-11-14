---
title: Installation
description: Run Gretlab on your own machine, with its database, the code judge's sandbox images and a first platform owner.
---

You need **Node 20+**, **pnpm** and **Docker**.

## Install and start

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

`pnpm sandbox:images` builds one Docker image per language for the judge. `pnpm db:seed` loads the
problem library. `pnpm dev` starts the web app, the runner and this documentation site
(`http://localhost:4321`).

## The minimum settings

In `apps/web/.env.local`, set at least:

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=anything-long-for-local-use
ADMIN_EMAILS=you@example.com
AUTH_DEV_LOGIN=true        # sign in without Google; ignored in production builds
```

Open `http://localhost:3000`, sign in with `you@example.com`, and go to **Dashboard**. People listed in
`ADMIN_EMAILS` are always platform owners.

:::note
Docker's Postgres listens on port **5433** and keeps its data in a Docker volume, so it survives
restarts. Don't prune Docker volumes.
:::

## The sandbox

Locally the runner can use Docker's ordinary runtime (the two `runc` lines in `.env`) so you don't need
gVisor. In production it refuses to start without gVisor (`runsc`), and the insecure setting is
rejected. See [Scaling and operations](/scaling/) for running the judge for real.

## Every setting

The web app reads its settings from `apps/web/.env.local` in development, and from the host in
production. The full table, with what each one does, is in the repository's `README.md` under
**Settings**; templates are `apps/web/.env.example` and `.env.example`.

## Next

- [Demo data](/setup/demo-data/): an organization of each kind, with months of activity.
- [Lab exams on your deployment](/deploy-exams/): the one setting network-limited exams need.
