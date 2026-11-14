---
title: Demo data
description: One command builds an organization of each kind with a few months of realistic activity and a sign-in for every role.
---

The demo builds six organizations (a school, a college, a coaching institute, a cohort program, a
company and a community) with a few months of realistic activity: registers, timetables, leave,
exams and report cards, assignments and submissions, contests, the library, transport, the hostel,
training, events and more. Dates are relative to today, and the same command builds the same data
every time.

## Run it

```bash
pnpm --filter @workspace/db demo
```

On its own, this only shows which database it would empty, and changes nothing. To build the demo,
choose the password the demo accounts will share and pass it as `DEMO_PASSWORD`:

```bash
DEMO_PASSWORD='<a password you choose>' pnpm --filter @workspace/db demo --wipe=<database name>
```

The password must pass the app's own password rules (at least 10 characters, not a common one); it's
checked before anything is wiped, and it isn't printed afterwards. The database name must be typed
exactly. It empties every table except configuration (settings,
language settings, runners, LTI keys, kind decisions and email wording), re-imports the problem
library and builds the organizations. Running it again replaces everything.

:::caution
`--wipe` deletes everyone's data in that database. Use it on a demo or local database, never on one
with real people in it.
:::

## Signing in

When it finishes, the command prints the demo accounts to try, one per role, with how to sign in.
They're printed on your own machine only, and they're deliberately not listed in these docs. Demo
addresses can't receive mail, so the demo never emails anyone.

Platform owners still come from `ADMIN_EMAILS`.
