<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Gretlab: project context

A coding lab a teacher or institution can run for their students: practice problems, graded submissions and contests, all configured from a dashboard. Read this before changing anything. Keep it current: when a decision changes or a roadmap item ships, update this file in the same change.

## Architecture

```
Browser ── Caddy ──▶ apps/web replicas ──▶ PgBouncer ──▶ Postgres ◀── apps/runner machines ── docker ──▶ gVisor sandbox
```

Full diagram, measurements and sizing: `docs/scaling.md`.

| Path | Role |
| --- | --- |
| `apps/web` | UI and the versioned REST API under `app/api/v1` |
| `apps/runner` | Claims queued submissions, compiles and runs them, records verdicts |
| `packages/db` | Drizzle schema, migrations, seed. The only place that defines tables |
| `packages/judge` | Language registry, verdicts, file validation, output compare, feature list. No I/O |
| `packages/ui` | Design tokens and shared components |
| `docker/sandbox` | One image per language |

## Decisions (and why)

- **No server actions.** All mutations go through REST route handlers in `app/api/v1`, wrapped by `route()` (auth, Zod validation, error shape). Business logic lives in `features/*/server`, not in handlers.
- **Sandbox: gVisor (`runsc`) + throwaway Docker containers.** Stronger than namespaces/seccomp alone and far simpler to operate than Firecracker. A backend sits behind the `Sandbox` interface, so Firecracker/Kata can be added.
- **Drizzle + postgres.js.** Thin over SQL, which contest leaderboards need.
- **Queue is Postgres** (`FOR UPDATE SKIP LOCKED`, leases with heartbeats, LISTEN/NOTIFY to wake runners), so there is no Redis to run. Move to a broker only if measurements demand it.
- **Scale runners by adding machines, not slots.** A Docker daemon levels off at 4-8 parallel jobs. No warm container pool: measured, it wouldn't address that limit.
- **Web replicas are stateless, each with its own short caches.** Settings reach other replicas within 5 s, public pages within 60 s. Add a shared cache only if those delays matter.
- **Measure before optimizing.** `e2e/load.mjs` finds the real bottleneck. It was not where it looked: the Docker CLI, for example, costs about 7 ms per call, so moving to the API isn't worth it.
- **Organizations in one deployment** (replaced "single tenant", November 2026). People keep one personal account and join several organizations: colleges, companies, communities. Each organization has its own groups (named per organization: Branch › Batch, Team, Cohort), members, roles and invite links. The platform owner creates organizations and names their first owner. Because organizations share a database, every query on organization data must be scoped to one organization; `e2e/orgs.mjs` tries to read across them.
- **Monaco, self-hosted** from `public/monaco`, so college networks that block CDNs still work.
- **Roles are read from the database on every request**, never trusted from the session cookie, so revoking takes effect immediately.
- **Public problem pages stay crawlable and need no account** (AdSense and search can't log in). Server execution requires sign-in; anonymous visitors run in the browser with Pyodide.

## Run and Submit (a product rule)

Same model as LeetCode and HackerRank. Keep them distinct everywhere.

- **Run** tries code on the cases in the panel: samples plus the student's own input. Nothing is graded or added to their submissions. An input matching a sample is compared with that sample's output, which the server looks up; anything else has nothing to compare with and ends as `OK` ("Finished"). A Run can't probe hidden tests.
- **Submit** grades against every test and is recorded in the student's history.
- **"Accepted" only ever means a graded submission passed everything.** Always display results through `verdictLabel()`, which enforces this. Runs are stored as `AC` when samples match, so showing `VERDICTS[verdict]` for a Run would claim something false.
- Hidden tests show their verdict and timing to students, never input, output or expected output. Staff see everything.

## Navigation (keep it this simple)

- The header's switcher (`features/account/scope-switcher.tsx`, shown to people in an organization) chooses whose content lists show: everything, personal (from no organization), any mix of organizations, or one; each organization can be opened from it. It's a per-browser cookie read by `useContentScope()`; Problems, Assignments, Contests and Teach filter with it and show a note with the hidden count and "Show everything". It only narrows lists; access is still decided on the server.
- One header everywhere (`components/page-header.tsx`): the site title, the organization switcher, the Learn/Teach toggle, then the current mode's sections. Learn: Problems, My classes (`/classes`), Assignments, Contests, Leaderboard, Playground. Teach: My classes (`/teach`), Organizations (managers who don't teach), Dashboard (platform staff), Playground. Only people who teach somewhere or are platform staff get the toggle (`features/account/mode.ts`); a page that belongs to one mode switches the header to it, and pages in both (a class, the playground) keep the last choice. Personal pages (profile, submissions, lists, sign out) live in the account menu. Don't add top-level links; put new pages under a section.
- Problems are at `/problems` (library) and `/problems/[slug]` (solve). `/questions/[slug]` only redirects, for old links.
- The dashboard sidebar is grouped by task: Content, Students, Setup.
- Say "problem", never "question", in anything a person reads.
- Messages must match who is reading: never tell a signed-in person to sign in. With server execution off, signed-in students run in the browser and Submit is paused.

## Problem statements are markdown

- A problem's `description` is its statement in markdown. Input format, output format and constraints stay separate fields (one bullet each, shown under their own headings), and samples come from its test cases. Keep them out of the statement. Editorials and hints are markdown too.
- Rendered by `components/markdown.tsx` (react-markdown with GitHub tables, lists and code). Raw HTML is shown as text, never run, so organizations can write problems safely. Don't add `rehype-raw`.
- Edited with `components/markdown-editor.tsx`: toolbar, Ctrl/⌘ + B, I, K, and a live preview using the same renderer.
- Images: the editor's image button, paste or drag-and-drop uploads to `POST /api/v1/uploads` (staff and people who teach; PNG, JPEG, GIF or WebP checked by their bytes, 2 MB, 300 a day each) and inserts `![name](/api/v1/uploads/<id>)`. Stored in Postgres (`uploads`, deduplicated by hash) so every replica serves them; served with `nosniff` and a sandboxing CSP. SVG is refused: it can carry scripts.
- Problems from before markdown kept their `statement` blocks; `db:migrate` turns any with an empty description into markdown (`statementToMarkdown`), and API callers that still send `statement` get the same conversion.

## Problem code per language

- Seeded problems carry editorials, hints, and starter code plus a reference solution in all five languages (`seed-data/content.json`); `e2e/full.mjs` judges every reference solution in the sandbox. Problems about Python features still have them in every language, printing exactly what Python prints (lists as `[1, 2]`, dicts as `{'a': 1}`).

- A problem's `code` holds, per language, optional starter code (exactly what the student's editor starts with, as normal code they can change: input reading, or an empty function plus the lines that call it) and a reference solution (a complete program, shown in the Editorial tab under the editorial's rules, never in page data). `solution` mirrors the Python solution for older callers; `code.python.solution` wins.
- There is no separate driver code: what's in the student's editor is exactly what runs. Older problems and API callers that send `driver` get it folded into the starter (`joinStarter`; migration 0017 for stored rows).
- "Generate from the reference solution" fills a language's starter code (`starterFromSolution` in `packages/judge/src/starter.ts`): input reading and imports stay, functions keep their signatures with empty bodies (Java gets a default `return` so it compiles), the logic becomes "Your code here". It's a draft for the teacher to review. Every generated starter for the seeded problems compiles.
- The editor treats an untouched blank file (the language's default, or empty) as no code, so a problem's starter replaces it; a new problem opens in the language last chosen.
- The Editorial tab sits beside Notes and fetches the editorial and solutions only when asked.

## Assignments (grading rules)

- Grades are computed from submissions every time, never stored, so changing points, due time or penalty regrades everyone at once. Rules live in `packages/judge/src/grading.ts` with unit tests.
- Only graded submissions from `opensAt` on count. Per problem: the best on-time result, or a better late one minus the penalty when late work is allowed. Partial credit comes from IOI-style scores.
- Only published problems can be assigned, because students solve them on the normal problem pages.
- The gradebook lists every active student, including those who haven't started. CSV fields are quoted and defused against spreadsheet formulas.
- Rubrics: each assignment problem may have up to 20 criteria marked by hand (`assignment_problems.rubric`); a problem is out of its test points plus the rubric's. Marks are stored per student (`rubric_marks`), clamped to each criterion (`rubricEarned`), and unknown criteria are refused. Marks are given in the gradebook's student panel.
- Line comments (`submission_comments`) go on a line that exists in that student's submission, from the same panel by selecting a line number. Teachers keep reusable comments (`feedback_snippets`, `/me/snippets`).
- "Hold feedback" (`assignments.hold_feedback`) keeps rubric marks and comments from students, and out of their totals, until the gradebook's "Release feedback". Released comments show under the lines on the student's submission page; rubric marks on the assignment page.

## Problems of an assignment, exam or contest

- A problem with `listed = false` is written for assessments: never in the library, public pages, daily challenge or lists (`isPublicProblem`). It's reached only through work that uses it: an assignment once it opens (an exam once the student has started), or a contest once it starts (`canReachProblem` → `usedInOpenWork`). Only its owner can put it in their work.
- The assignment and contest forms' problem picker has **Write a problem** (the problem editor in a dialog, `NewProblemDialog`) and **Import problems**; both create unlisted, ready problems and add them. The problem library has Import too, choosing published and listed.
- One import format everywhere: `docs/problem-format.md`, template at `/problem-template.json`, parsed in `features/problems/import.ts` (friendly field names → `ProblemInput`). Every problem is checked before any is saved; taken addresses get a number.
- Assignment problems are solved on the assignment's own pages, `/assignments/[slug]/problems/[n]` (`getAssignmentProblem`, `AssignmentWorkbench`): numbered Q1, Q2 by the assignment, only its problems in the list, no ads, no library numbering.

## Lab exams

- An assignment with `exam` settings (`ExamSettings` in `packages/judge/src/exam.ts`, pure rules with unit tests) is taken in one sitting per student (`exam_sessions`). Start fixes its end: the time limit or the due time, whichever is first. Starting again returns the same sitting; once it's over there's no second one. Exams take no late work. `startWithin` limits Start to the first minutes after opening, so a lab starts together.
- All sitting times use the database clock (`dbNow`), the clock submissions are stamped with; pages get the server's `now` and correct the device's clock. Work stamped up to `SUBMIT_GRACE_MS` (10 s) after the close counts (a last-second press).
- Grading counts only submissions made during the student's sitting (`duringSitting`), none without one, hand marks included.
- **The site locks to a running exam.** Server (`features/exams/server.ts`, `activeExam`): runs and submissions only on the exam's problems (no playground, other problems or contests), from its networks; no editorial of any problem; the library's problem API, notes, and earlier submissions and drafts (from before the sitting) are refused; drafts only for the exam's problems and from its networks. Exam submissions skip load shedding. Pages (`ExamLockProvider` in the root layout): any page outside the exam's own sends the student back to it, the header becomes the exam and its clock (`ExamHeader`), and the tab, fullscreen and paste listeners run on every page. Outside fullscreen a solid cover makes everything else `inert` (no mouse or keyboard).
- An exam's problems show once the student starts, numbered Q1.. on the exam's pages, without hints, notes, tags or editorial in the data. A library problem's page doesn't mention an exam until the student has started it. Library problems are public, though: for a closed exam write or import the exam's own problems (the form warns).
- Once students have started, an exam can't stop being an exam or change its problems (`exam_started`); time, due time, networks, points and rubrics can change (running sittings keep their end).
- Networks: IPv4 and IPv6 addresses or CIDR ranges. Starting, submitting and saving drafts during a sitting need an address inside them; the list is never sent to students. The address comes from `clientIp()` (`lib/api/client-ip.ts`), and only from Caddy: it sets `X-Client-IP` and `X-Proxy-Secret` (`deploy/Caddyfile`), and the app believes the address only when that secret equals `PROXY_SECRET`. Without the secret, a network-limited exam can't be saved (`addresses_unverifiable`) and starts are refused: failing closed. A balancer in front of Caddy goes in its `trusted_proxies`. Setup: `docs/deploy-exams.md`.
- Runner failures: a graded submission that ends in "System error" is judged again by the runners after 2 minutes (`retrySystemErrors`, up to 3 rounds, for a week), keeping its submit time, so in-time exam work counts. The gradebook's **Re-judge system errors** re-queues all of an assignment's after a longer outage. Students see that it will be retried.
- The browser reports leaving the tab or window, leaving fullscreen and pasting text not copied on the page; the server records refused submissions from other networks (`exam_events`, at most 200 of each kind per sitting, counted and inserted in one statement). Records for the teacher, not proof.
- The gradebook shows each student's sitting and warning count (also in the CSV); the student panel lists the events and where it started from, marks submissions outside the sitting, and gives more time (`extend`: reopens a finished sitting, may pass the due time, keeps their work; also the fix when a final submission was lost to a runner failure). **Forget addresses** deletes the stored network addresses once they're no longer needed.

## Course and program outcomes (CO–PO)

- Program outcomes (`program_outcomes`) belong to an organization and are edited under Manage › Outcomes with an organization-wide "Change settings" grant ("Start from NBA's PO1–PO12" fills a template to edit). The same page sets attainment rules (`organizations.attainment`; default: a student reaches a CO at 60%, levels 1/2/3 at 50/60/70% of students).
- Course outcomes (`course_outcomes`) belong to a class (a group), set on its Outcomes tab by whoever may set assignments for it, each mapped to POs at strength 1–3. Editing keeps ids, so tags and mappings follow an outcome; removing a CO strips it from tagged problems.
- Assignment problems are tagged with COs (`assignment_problems.outcomes`) from the assignment form; only the organization's own COs are accepted.
- Attainment is computed, never stored (`packages/judge/src/outcomes.ts`, unit-tested; `classOutcomes` in `features/classes/server.ts`): per CO, each student's marks on tagged problems in published assignments reaching the class, counting only students those assignments are for; then the share reaching the threshold gives the level; a PO is its COs' levels weighted by mapping strength. Teachers who can see the class's grades get the report and a CSV; students don't see it.

## Organizations and permissions

- Platform roles (`users.role`: student, teacher, admin) still run the platform dashboard. Inside an organization, access comes only from organization roles.
- Permissions are a fixed list in `packages/judge/src/permissions.ts`; roles are bundles of them stored per organization. Built-in roles (Owner, Admin, Teacher, Member) can't be edited or deleted; organizations add their own.
- A role is given across the organization or within one group, and then covers that group and every group under it. Organization-wide actions need an organization-wide grant.
- Roles count only while the membership is active (not while a join request is pending).
- Nobody can create, give, change or take away a role with permissions they don't hold for that scope. Only owners make or remove owners; the last owner can't leave or be removed. Platform admins can act in any organization, and it's logged.
- Every change to members, groups, roles, invites and settings is written to `audit_log` in the same transaction.
- Joining: open, approval, invite only, plus email domains that skip approval. Invite links can carry a role and a group, an email, a use limit and an expiry; uses are counted atomically.
- A member chooses whether the organization sees their practice progress (`share_progress`). Work for that organization's own assignments and contests is always visible to it.

## Organization content (how access works)

- Contests, assignments, notices and problems have an `orgId` (null for the platform's own). Contests and assignments have an `audience`: conditions that must all hold, each met by being in any of its groups or a group inside one (`string[][]`). `[[3rd Year], [CAC]]` is third-year students taking CAC, in every section; `[]` is the whole organization. Subjects, labs and electives are ordinary groups, so any combination can be targeted.
- `features/orgs/access.ts` is the one check for who may take part in or manage content (`viewpoint` + `accessTo`). Lists, detail pages, contest registration, submissions, leaderboards, gradebooks and the problem page's assignment chips all use it. Content someone can't take part in answers 404, not 403.
- Managing content needs the permission for all groups of at least one of its conditions (everyone reached is inside each condition), or organization-wide for content with no conditions. A CAC teacher can set work for "3rd Year and CAC", not for all of 3rd Year.
- People sit in the last level of the group tree (a section, team, lab or subject); being in a section is what puts someone in its year. Adding someone to a group with groups inside adds them to every last-level group in it (`leavesUnder`): the panel, the member editor, import and student invites all do this. 3rd Year with Sec A (Lab 1) and Sec B (Lab 2, Lab 3) means Lab 1, Lab 2 and Lab 3. A teacher's role may still cover a whole branch without them sitting in it.
- When the structure changes: a group's first group inside takes the group's people down into it. Deleting a group that has people (in it or any group inside) is refused with `group_not_empty` unless forced (`?force=true`); forcing takes them out of it and moves nobody, because moving them up would count them in groups they weren't in. The page asks: empty it first, or delete and take them out. Removing a level is refused while groups that deep exist. People sitting directly in a group with groups inside (older data) show as "not placed yet", listed above the tree so folding never hides them, and are placed with the panel's Move. Group counts include everyone inside.
- Choosing one group always uses `GroupPicker` (`features/orgs/components/group-picker.tsx`), never a plain select: a searchable tree in a popover that names each level and shows full paths when searching. Big trees open at the top level. Choices that aren't groups ("Everyone", "Whole organization") go in `extra`.
- Group checkboxes everywhere use `GroupChecklist`: ticking a group ticks everything inside it, unticking one unticks the groups above it, and a partly ticked group shows a partial tick. It searches, folds and scrolls instead of growing. Role areas work the same for their permissions. Audiences are saved as the topmost ticked groups (same people, clearer summary); member groups are saved as ticked.
- The audience form shows a live count and sample names (`POST /orgs/[slug]/audience`). The Groups page is built for hundreds of people per group: the tree starts folded (Expand all / Collapse all), and a group's panel (opened when a group is created) groups its people into folded sections per group inside it, 50 at a time, with search. Member pages edit groups and roles in dialogs and show three group chips with the rest behind "+N more". Each person can be moved to another group (including another lab of the same section) or removed; ticked people move or leave together. Moving chosen people (`POST /groups/[id]/move` with `userIds`) takes them out of the source group and everything inside it, then adds them to the target's last-level groups; moving a whole group's people into a group inside it is refused. Removing (`POST /groups/[id]/members/remove`) takes people out of the group and everything inside it, never out of the organization.
- Management functions take the owner (`orgId`, null for the platform) and match it in every query, so an id from another organization is simply not found. The dashboard screens are shared: `useOwner()` gives them platform or organization paths.
- Drafts can be used only by whoever wrote them. Assignments use published problems only. Organization notices never appear on public pages.
- Members-only problems (`problems.members_only`) are never in `isPublicProblem`: not in the library, public problem pages, the daily challenge, profiles or lists. Members solve them at `/orgs/[slug]/practice/[problem]`; `canReachProblem` gates submissions and solutions. Only their organization can use them in contests and assignments.
- An organization's `languages` and `allow_paste` apply to its contests and members-only problems. Languages are enforced on submit. Paste blocking only undoes pastes in the editor: a deterrent, not security.
- Class ratings are one per student per class, for classes of the student's groups in the last 14 days. Teachers see averages and comments, never names.
- Built-in roles take their permissions from code (`rolePermissions`), so new permissions reach existing organizations without a migration.
- Reports count activity from the organization's own assignments and contests, and general practice only for members who chose to share it. Gradebooks and reports leave out people with teaching permissions.

## Classes (the LMS view)

- A class is a group someone teaches, at any level. `/orgs/[slug]/classes/[groupId]` gathers everything about it in tabs: Stream (class notices, logged classes, new work), Classwork (assignments and contests reaching it, syllabus), People, Grades, Syllabus and log (with attendance) and Insights. Teachers of the group see all of it; students sitting in it or a group inside it see their side; everyone else gets 404. `features/classes/server.ts` holds the rules.
- Content reaches a class when one of its conditions names the class, a group above it ("From CSE") or a group inside it; organization-wide content reaches every class. Students still only see what `accessTo` lets them take part in.
- "New assignment" and "New contest" from a class open the form with `?for=<group>`: aimed at the class, and back to it after saving.
- Notices can be aimed at a class (`notes.audience`). A notice for the whole organization needs organization-wide "Post notices"; a class teacher posts from the class page and can remove only notices for groups they cover.
- Attendance is marked when logging a class, for people in that class only (`attendance` table). Below 75% shows red to the teacher and the student.
- Teach (`/teach`) lists a teacher's classes per organization as the group tree, with "Due this week" and "Behind the syllabus" first. Students' `/classes` lists the last-level groups they sit in. Assignments and contests link to the classes they're for (`classLinks`).

## Privacy of student data

- Drafts: a signed-in student's code is saved to their account (`drafts`, every few seconds while typing and at once when leaving, running or submitting), so it follows them to any computer; the editor takes whichever copy changed last. Each change is kept as a snapshot (`draft_snapshots`, the latest 2000 per problem and language) for playback. Only the student and teachers who can already see that student's graded work on an assignment (`studentAttempts`) see them: the gradebook's Working copy (live) and Playback tabs. The editor's save indicator tells students this.
- Notes and personal lists are private to their owner; a list is only visible to others if it's a published study plan. Other people's private lists answer 404, not 403.
- Profiles and the leaderboard need sign-in and show names and handles, never emails.
- Editorials and solutions are unlocked by solving the problem when `practice.solutions_after_solve` is on, and are never in public page data.

## Sandbox rules (security-critical; do not relax)

Learned from the 2024 Judge0 escapes (privileged container, host touching sandbox symlinks, sandbox reaching the database).

1. Never `--privileged`, never mount the Docker socket or any host path into a sandbox.
2. `--network none`, read-only rootfs, all capabilities dropped, `no-new-privileges`, non-root user, memory/CPU/PID/file-size limits on every container.
3. The host never reads or writes paths inside a sandbox. Files go in as a tar we generate (regular files only); results come back only over stdout/stderr streams.
4. Hidden test expected outputs and solutions never enter a sandbox or reach a student's browser. Comparison happens in the runner.
5. Paths are validated against an allowlist before use, and commands are spawned with argument arrays, never through a host shell.
6. A dead sandbox's stderr is runtime internals: never show it to a student. Test under real gVisor, because Docker reports a dead sandbox slightly late and the race only shows there.
7. Fail closed: the runner refuses to start without `runsc` unless `SANDBOX_ALLOW_INSECURE_RUNC=true`, which is rejected when `NODE_ENV=production`.
8. The runner host is effectively root-equivalent (Docker access). Run it on a dedicated VM holding no secrets beyond its database credentials.

## Conventions

- Every new dashboard-controllable behaviour gets an entry in `packages/judge/src/features.ts` and is enforced with `requireFeature()` or `getSettings()` on the server. Hiding UI alone is not enforcement.
- New language: add to `packages/judge/src/languages.ts` and `docker/sandbox/<id>/Dockerfile`, then run `docker/sandbox/build.sh`.
- Schema change: edit `packages/db/src/schema.ts`, then `pnpm db:generate`. Commit the migration.
- Styling rules are in `README.md`.
- UI controls come from shadcn in `packages/ui` (Base UI style "base-vega"): Button, Input, Textarea, NativeSelect, Checkbox, Switch, RadioGroup, Slider, Dialog, AlertDialog, DropdownMenu, Popover, Collapsible, Label. Don't use native `<button>`, `<input>`, `<select>`, `<textarea>`, `<details>` or hand-made popups. Need another one? `pnpm exec shadcn add <name>` in `packages/ui` (answer no to overwriting `button.tsx`), then change its `cn` import to `@workspace/ui/lib/utils`, which knows the type scale. `components/form.tsx` wraps them for forms (TextInput, SelectInput, TextArea, Check, Field).
- Every destructive action (delete, remove, leave, suspend, block, reset, decline, revoke) asks first in an AlertDialog with a red button naming the action: use `ConfirmButton` or `ConfirmDialog` from `components/confirm.tsx`. Tests confirm in the `alertdialog`.
- shadcn's base-vega DropdownMenu shipped with a forced `dark` class and a see-through background, which made menus dark-on-dark in light mode; it now uses `bg-popover`. Check new registry components in both themes.
- Schemas shared with forms (`features/*/schemas.ts`, `lib/api/version.ts`) are loaded in the browser: they may import zod and `@workspace/judge`, never `@workspace/db`, `lib/api/route` or a `server.ts`. Doing so pulls Postgres into the client bundle and breaks every form page.
- Saves of problems, assignments and contests send the `updatedAt` the form opened with (`expectedUpdatedAt`); a newer version refuses the save with `edited_elsewhere` (`lib/api/conflict.ts`) and the form offers "Load their version" or "Keep mine".
- Tests find a checkbox by role (`getByRole("checkbox", { name })`): Base UI pairs it with a hidden native input that a wrapping label also names.

## Testing

- `pnpm test`: fast unit tests (leaderboard, file names, settings).
- `pnpm test:e2e`: everything against a throwaway database and real gVisor: queue guarantees, 16 hostile programs, API security, every seeded solution, contests, the browser UI. Run it before merging anything touching the sandbox, queue, auth or the API.
- `e2e/stack.sh` with `e2e/load.mjs` and `e2e/resilience.mjs`: load and failure tests on the production shape. See `docs/scaling.md`.
- `e2e/features.mjs`: library, daily, streaks, notes, lists, study plans, profiles, leaderboard, hints, editorials, integrity, editor extras and their switches.
- `e2e/orgs.mjs`: joining, invites, groups, scoped roles, no-escalation, owners, the activity log, several organizations; organization content aimed at groups (contests, assignments, problems, notices, gradebooks, import); teaching logs, teacher home and reports; outcomes (POs, COs, tagging, attainment); and the pages.
- `e2e/assignments.mjs`: grading rules, late penalties, gradebook and CSV, privacy, drafts and playback, rubrics, line comments and releasing feedback, lab exams (sittings, networks, events, more time, the site-wide lock, start window, edits after starting), problem import and assessment-only problems, the switch and the pages.
- `e2e/flows.mjs`: Run vs Submit, history and creating a contest, as a person uses them. Included in `pnpm test:e2e`.
- After a mutation, invalidate every query that shows that data. Stale contest data was the cause of several real bugs: "not registered" after registering, and old results after submitting.
- Check that a test actually ran. A filter or quoting mistake has twice produced output that looked like a result.
- Passing checks don't prove a page looks right. Look at the screenshots it writes to `/tmp/gretlab-e2e`: visual bugs and the "Run counts as solved" bug were both found that way.

## Roadmap

Status is updated as items ship; anything not ticked has not been built.

- [x] Sandbox runner with gVisor, attack tests
- [x] Postgres schema, migrations, seed from `content.json`
- [x] REST API: problems, submissions, languages, contests, dashboard
- [x] Monaco editor: multiple files, highlighting, line numbers, formatting, completion
- [x] Sign-in for all users, roles, registration settings
- [x] Dashboard: settings, languages and limits, problems and tests, notices, users, submissions
- [x] Contests: registration, ICPC and IOI scoring, scoreboard freeze
- [x] Run vs Submit model, submission history, contest pages and creation form
- [x] LeetCode-style practice: problem library with tags, filters and acceptance; daily challenge and streaks; hints; editorials unlocked by solving; private notes; favorites, lists and staff study plans; profiles with heatmap and badges; global leaderboard; stopwatch and editor preferences
- [x] Assignments: problem sets with open and due times, late penalties, automatic grading from submissions, gradebook with CSV export
- [x] Organizations (part 1): personal accounts in several organizations; groups per organization; join by open, approval, domain or invite link; custom roles with group scope; activity log; platform list of organizations
- [x] Organizations (part 2): contests, assignments, problems and notices owned by organizations and aimed at groups; group-scoped gradebooks; CSV member import with a preview
- [x] Organizations (part 3): teacher home across organizations, per-group syllabus and class log with progress and "behind" warnings, organization reports with CSV
- [x] Organizations (part 4): members-only problems on members' pages; student code from the gradebook; anonymous class ratings; per-organization languages and paste blocking for its contests; Excel (.xlsx) import
- [x] HackerRank-style integrity: plagiarism similarity checks (winnowing, rename-proof)
- [x] Saved drafts: code follows students between computers; teachers see it live and play back how it was written
- [x] Feedback: rubrics per assignment problem, line comments with saved comments, feedback held until released
- [x] Lab exams: timed single sittings, start window, lab network limits (IPv4/IPv6), site-wide lock during a sitting, tab/fullscreen/paste records, more time per student, forgetting addresses
- [x] Problems of an assignment, exam or contest: written or imported in their forms, kept out of the library; one import file format; assignment problems solved on the assignment's own pages
- [x] Outcomes: program outcomes per organization, course outcomes per class mapped to them, problems tagged with COs, CO and PO attainment with CSV
- [x] Classes: class pages (stream, classwork, people, grades, syllabus and log, insights), class notices, attendance, teacher class tree with today's work, student My classes, Learn/Teach modes, organization switcher
- [x] Scale: replicas, load balancer, connection pooling, queue priorities, load shedding, crash recovery, metrics, containers

Next, roughly in order of value for a college deployment:

0. Organizations, next: per-organization time and memory limits; class feedback reminders; members-only problems inside study plans; tagging assignments with syllabus topics; a server-paged members list for very large organizations.
0. From the LeetCode/HackerRank research, not built yet: discussion and solution posts with votes and moderation; contest ratings (Elo-style, newcomers rated separately) and contest history; virtual contests; contest code replay; test-case groups; company/position filters (n/a for a college); AI help (needs a policy decision first).

1. A separate, least-privilege database role for runners.
2. Student sign-in without Google: email and password, or college SSO (SAML/OIDC).
3. Assignments for a class group only (today every student sees every published assignment); extensions for one student.
4. CSV roster import and class groups.
5. Plagiarism: cross-language detection and a side-by-side diff view (pairwise similarity within a language is built, under Plagiarism check).
6. Rate limiting on public endpoints at the edge; a Content-Security-Policy (Monaco and AdSense need care).
7. Audit log of staff actions; monitoring and alerts for queue depth.
8. Measure scale-out on real machines (see "What this does not prove" in `docs/scaling.md`); read replica for leaderboards if a contest ever needs it.
9. Server-side language servers for C++ and Java completion (only Python and JavaScript have real completion today).
10. Custom checkers for problems with more than one right answer; subtasks for IOI scoring.
11. Per-organization single sign-on and branding.

### Known limits

- Memory measurements come from inside the sandbox and are informational; time limits are enforced by `timeout` with a host-side backstop.
- Under gVisor a fork bomb can stop the whole sandbox rather than just failing `fork`. It is contained and reported as a failed run, and any remaining tests are not judged.
- Scale-out across machines is designed and tested for correctness, but its throughput has only been measured on one laptop.
