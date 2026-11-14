---
title: Editing the docs
description: Where these pages live, how to add one, and how the site is built and deployed.
---

These docs are the repository's `docs/` folder, published by the Astro site in `apps/docs`. Each page
has one home: it reads on GitHub, the app and code can point at `docs/<name>.md`, and the site
publishes it.

## Add a page

1. Write a Markdown file under `docs/` (for example `docs/features/daily/holidays.md`) with a `title`
   and a one-line `description` in its frontmatter. The title is the page's heading, so don't repeat
   it with a `#` line.
2. Add it to the sidebar in `apps/docs/astro.config.mjs`. Top-level groups are the header's section
   tabs.

Pages are plain Markdown: they can't import components. Callouts use Starlight's asides
(`:::note`, `:::tip`, `:::caution`).

## A feature page's "At a glance"

A feature page can describe itself in its frontmatter, and the page's top turns it into cards:

```yaml
glance:
  who:
    - role: Teacher
      note: their own classes
  where:
    path: /orgs/<slug>/manage/attendance
    menu: "Every day › Attendance"
  permissions: [attendance.mark, attendance.view]
  module: attendance
```

Permission and module keys are checked against the app (`packages/judge`) when the site builds, so a
renamed one fails the build instead of going stale. Labels and which kinds have a module come from the
app too.

:::caution
Never put sign-in details in these docs: no demo accounts, emails or passwords. They're public. The
`glance` block has no field for them, and any field it doesn't know fails the build.
:::

## Generated pages

[Roles](/reference/roles/), [Permissions](/reference/permissions/) and
[Kinds and modules](/reference/kinds-and-modules/) are built from `packages/judge` by the pages in
`apps/docs/src/pages/reference`. Change the app and they follow.

## Run and build

```bash
pnpm --filter docs dev        # http://localhost:4321
pnpm --filter docs build      # static site in apps/docs/dist
pnpm --filter docs typecheck  # astro check
```

The site is deployed on Vercel as its own project with Root Directory `apps/docs`, at
`https://docs.gretlab.grettech.com`.
