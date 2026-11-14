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
| `e2e` | Whole-system tests (`run.sh` runs them all), plus load and failure tests |
| `docs` | Problem and question import formats, exam deployment, scaling |
| `deploy`, `docker-compose.*.yml` | Production: Caddy, web replicas, PgBouncer (`prod`), runner machines (`runner`), local Postgres (plain) |

Where each feature lives (`apps/web/features/<name>`: UI in `components/`, rules in `server.ts`, browser-safe form schemas in `schemas.ts`; pure, unit-tested rules in `packages/judge/src/<name>.ts`):

| Feature | Code |
| --- | --- |
| Problems, library practice, daily, lists, profiles | `problems`, `catalog`, `lab`, `editor` |
| Question bank and quizzes | `questions`; rules `judge/quiz.ts` |
| Assignments, grading, gradebook, rubrics, feedback | `assignments`, `feedback`, `admin/components/assignments.tsx`; rules `judge/grading.ts` |
| Lab exams | `exams`; rules `judge/exam.ts` |
| Contests | `contests` |
| Organizations, groups, roles (fine-grained, with parents), invites, import | `orgs`; permissions `judge/permissions.ts` |
| Classes, attendance, teaching log, reports | `classes`, `teaching` |
| Outcomes (CO–PO) | `outcomes`; rules `judge/outcomes.ts` |
| Platform staff and roles, activity log | `platform`; rules `judge/platform.ts` |
| Library, sharing, collections | `library` (`sharing.ts` is the one rule for what an owner may use) |
| Courses | `courses`; release rules `judge/course.ts` |
| Templates | `templates` |
| Early warnings | `classes/warnings.ts`; rules `judge/warnings.ts` |
| Discussions | `discussions` |
| Peer review | `peer`; rules `judge/peer.ts` |
| Calendar and iCal | `calendar`; `judge/ical.ts` |
| Certificates | `certificates` |
| GitHub projects | `projects`; link rules `judge/github.ts` |
| LTI 1.3 | `lti`; launch rules `judge/lti.ts` |
| Notifications and email | `notifications` (`policy*.ts`, `digest.ts`, `outbox.ts`, `mailer/`); rules `judge/notifications.ts`, `judge/outbox.ts` |
| Settings and switches | `settings`; list `judge/features.ts` |

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
- One header everywhere (`components/page-header.tsx`): the site title, the organization switcher, the Learn/Teach toggle, then the current mode's sections. Learn: Problems, My classes (`/classes`), Assignments, Contests, Leaderboard, Playground. Teach: My classes (`/teach`), Organizations (staff who help run one without teaching), Dashboard (platform staff); no Playground, which is for trying code and belongs to Learn. Teach exists for people who teach somewhere, help run an organization (any role beyond member), or are platform staff, and starts where their side is (`useTeachSide` in `features/account/account-menu.tsx`): `/teach` if they teach, else `/orgs`, else `/admin`. A page that belongs to one mode switches the header to it (`features/account/mode.ts`: `/teach`, `/admin`, the `/orgs` list and organizations' management); pages in both (a class, an organization's home, the playground) keep the last choice. Personal pages (profile, submissions, organizations, Calendar, My certificates, lists, sign out) live in the account menu. Don't add top-level links; put new pages under a section.
- Problems are at `/problems` (library) and `/problems/[slug]` (solve). `/questions/[slug]` only redirects, for old links.
- The platform dashboard sidebar is grouped by task, each item shown only to roles with its permission: Content (Library, Courses, Problems, Questions, Units, Assignments, Templates, Contests, Daily challenge, Study plans, Notices), Students (Users, Submissions, Plagiarism check), Setup (Organizations, Staff and roles, Activity, Languages, Settings). An organization's Manage sidebar works the same (Members, Groups, Roles, Invites, Import, Assignments, Templates, Contests, Library, Courses, Problems, Questions, Reports, Notices, Outcomes, Settings, LMS (LTI), Activity).
- Say "problem", never "question", in anything a person reads.
- Messages must match who is reading: never tell a signed-in person to sign in. With server execution off, signed-in students run in the browser and Submit is paused.

## Problem statements are markdown

- A problem's `description` is its statement in markdown. Input format, output format and constraints stay separate fields (one bullet each, shown under their own headings), and samples come from its test cases. Keep them out of the statement. Editorials and hints are markdown too.
- Rendered by `components/markdown.tsx` (react-markdown with GitHub tables, lists and code). Raw HTML is shown as text, never run, so organizations can write problems safely. Don't add `rehype-raw`.
- Edited with `components/markdown-editor.tsx`: toolbar, Ctrl/⌘ + B, I, K, and a live preview using the same renderer.
- Images: the editor's image button, paste or drag-and-drop uploads to `POST /api/v1/uploads` (staff and people who teach; PNG, JPEG, GIF or WebP checked by their bytes, 2 MB, 300 a day each) and inserts `![name](/api/v1/uploads/<id>)`. Stored in Postgres (`uploads`, deduplicated by hash) so every replica serves them; served with `nosniff` and a sandboxing CSP. SVG is refused: it can carry scripts.
- Problems from before markdown kept their `statement` blocks; `db:migrate` turns any with an empty description into markdown (`statementToMarkdown`), and API callers that still send `statement` get the same conversion.

## Units

- Units are the platform's course outline for the library (Unit 1 · Basics, …); organizations' problems stand alone. Dashboard › Units (`features/admin/components/units.tsx`): add, reorder (↑ ↓), delete (asking where its problems go: another unit, or none). A unit's Edit dialog renames it and sets exactly which problems are in it and their order: add from any unit (it moves), move a problem to another unit or to none, undo before saving (`setUnitProblems`, one transaction). The problem editor can also set a problem's unit. Reordering units lists every unit once (`bad_order` otherwise).
- Admin lists that could grow (units, the daily challenge's days) stay one line per row, with the details edited in a dialog.

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
- Quiz questions live in a bank (`questions`), owned like problems (platform or an organization; Dashboard › Questions), written in the question editor or imported (`docs/question-format.md`, template `/question-template.json`). Kinds: single and multiple choice (marked automatically; multiple needs exactly the right set), short answer (marked automatically only when it matches an accepted answer, ignoring case, spacing and a final full stop; otherwise a teacher marks it), written (always a teacher). Rules: `packages/judge/src/quiz.ts`, unit-tested. A question used anywhere can't be deleted.
- Assignments and exams pick questions with the question picker beside the problem picker (`assignment_questions`, each with its own points): problems, questions, or both. Organizations can also pick the platform's ready questions. Write a question and Import questions are in the picker, so the form stays short.
- Contests pick questions that mark themselves (`contest_questions`, labelled Q1, Q2 after the problems). A registered contestant answers each once while it runs, marked at once (`contest_answers`); on the board a right answer is a solve (ICPC) worth its points (IOI). Right answers show after the contest.
- The daily challenge is a problem, a question (the platform's, marking itself), or both (`daily_challenges.question_id`; a day with only a question has no problem). One answer a day (`daily_answers`), shown right or wrong with the explanation at once; a right answer keeps the streak.
- Students' answers (`quiz_responses`) save as they type and can be changed until their time is up (personal due time; an exam: their sitting); whatever is saved then counts. No submit step. Teachers and admins can replace any mark from the gradebook's Quiz column (null goes back to automatic); they see marks at once.
- Students see quiz marks, right answers and explanations after their due time (an exam: after their sitting), unless the form's "Hold results until I release them" is on; then at **Release results**, which also covers rubric marks and comments and notifies them. Right answers are never in the data before that.
- Extensions (`assignment_extensions`): a later due time for one student, for the whole assignment or only some problems (reopening them after feedback is resubmission). Grading uses `extendedDue` per problem; the student's phase and due line use `personalDue`. For an exam it lets an absent student start later (the start window is waived). Given from the gradebook's Extend; audited for organizations.
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
- Networks: IPv4 and IPv6 addresses or CIDR ranges. Starting, submitting and saving drafts during a sitting need an address inside them; the list is never sent to students. The address comes from `clientIp()` (`lib/api/client-ip.ts`; the rule, unit-tested, in `packages/judge/src/client-ip.ts`) and only from something the visitor can't forge: first `CLIENT_IP_HEADER`, a header the operator vouches their host sets and visitors can't bypass (for `x-forwarded-for`, its last entry); on Vercel (`VERCEL=1`), its edge's `x-vercel-forwarded-for`; elsewhere Caddy, which sets `X-Client-IP` and `X-Proxy-Secret` (`deploy/Caddyfile`), believed only when that secret equals `PROXY_SECRET`. With none, a network-limited exam can't be saved (`addresses_unverifiable`) and starts are refused: failing closed. A balancer in front of Caddy goes in its `trusted_proxies`. The exam settings show "Your address right now" (`GET /api/v1/me/address`) to check against. Setup: `docs/deploy-exams.md`.
- Runner failures: a graded submission that ends in "System error" is judged again by the runners after 2 minutes (`retrySystemErrors`, up to 3 rounds, for a week), keeping its submit time, so in-time exam work counts. The gradebook's **Re-judge system errors** re-queues all of an assignment's after a longer outage. Students see that it will be retried.
- The browser reports leaving the tab or window, leaving fullscreen and pasting text not copied on the page; the server records refused submissions from other networks (`exam_events`, at most 200 of each kind per sitting, counted and inserted in one statement). Records for the teacher, not proof.
- The gradebook shows each student's sitting and warning count (also in the CSV); the student panel lists the events and where it started from, marks submissions outside the sitting, and gives more time (`extend`: reopens a finished sitting, may pass the due time, keeps their work; also the fix when a final submission was lost to a runner failure). **Forget addresses** deletes the stored network addresses once they're no longer needed.

## Course and program outcomes (CO–PO)

- Program outcomes (`program_outcomes`) belong to an organization and are edited under Manage › Outcomes with an organization-wide "Change settings" grant ("Start from NBA's PO1–PO12" fills a template to edit). The same page sets attainment rules (`organizations.attainment`; default: a student reaches a CO at 60%, levels 1/2/3 at 50/60/70% of students).
- Course outcomes (`course_outcomes`) belong to a class (a group), set on its Outcomes tab by whoever may set assignments for it, each mapped to POs at strength 1–3. Editing keeps ids, so tags and mappings follow an outcome; removing a CO strips it from tagged problems.
- Assignment problems are tagged with COs (`assignment_problems.outcomes`) from the assignment form; only the organization's own COs are accepted.
- Attainment is computed, never stored (`packages/judge/src/outcomes.ts`, unit-tested; `classOutcomes` in `features/classes/server.ts`): per CO, each student's marks on tagged problems in published assignments reaching the class, counting only students those assignments are for; then the share reaching the threshold gives the level; a PO is its COs' levels weighted by mapping strength. Teachers who can see the class's grades get the report and a CSV; students don't see it.

## Platform staff and roles

- The platform dashboard is run by staff with platform roles, like organizations' roles: a fixed permission list (`packages/judge/src/platform.ts`: library, sharing, work, grades, submissions, colleges, users, settings, roles, activity log), built-in roles (Owner, Content admin, Reviewer, Support) that can't be changed, and custom roles (`platform_roles`). Who holds what: `platform_staff`.
- `platformAccess()` (`features/platform/access.ts`) reads it on every request: ADMIN_EMAILS are always owners; staff have their role; anyone else falls back to their account role (admin: Owner, teacher: Content admin), which is how the platform worked before roles. Giving a role sets the account role to match (owner → admin, others → teacher; removing → student), so older "is staff" checks stay right.
- Every platform route names the permission it needs (`route({ access: "platform.…" })`); dashboard pages need some platform role and the menu shows only what the role allows. Roles are given on Staff and roles, never on the Users page (which only blocks and unblocks).
- Rules: nobody gives or makes a role with permissions they don't hold; only owners make or change owners; the platform keeps at least one owner; ADMIN_EMAILS owners can't be removed in the app; nobody blocks someone with more access. Platform changes (staff, roles, settings, languages, colleges, blocking) go in the activity log (`audit_log` with no organization), shown on Activity.

## The library (one place for content, shared)

- Problems and questions are written once and reused. Each owner (the platform, or one college) has a Library page (Dashboard › Library, Manage › Library: `features/library`) listing its own items and what reaches it, with search, filters (source, difficulty or type, status) and collections (`collections`, `collection_items`: folders that only group items, per owner).
- The platform's items have `sharing`: `everyone` (every college), `selected` (colleges and teachers in `content_shares`) or `owner` (platform staff only). Set from the Library's Share dialog with the `platform.library.share` permission; audited. A college's own items are always `owner`: nobody else sees them.
- `usableBy` / `usableIds` (`features/library/sharing.ts`) is the one rule for what an owner may use: its own items, or published items shared with it. The pickers, assignment, contest and daily saves, the library and collections all use it. Public library practice is separate and unchanged (`isPublicProblem`).
- A college copies an item it can use to adapt it (`copyToLibrary`): the copy is its own, private, remembers `copied_from`, and a copied problem starts as a draft with its tests.

## Templates

- A template (`templates`, `features/templates`) is an assignment or exam written once: problems with points and rubrics, questions, late rules, held results, exam settings (without lab networks, which belong to each use). No address, dates or audience. It's edited with the assignment form in template mode (`AssignmentEditorPage template`), and any assignment can be saved as one ("Save as template").
- Using a template makes one ordinary assignment per class (or one for the platform), each with its own dates, address and gradebook (`applyTemplate`; `assignments.template_id`). Each use needs "Set assignments" for its class (organization-wide for one without a class).
- Saving a template brings its content to every use that hasn't opened yet (`bringChanges`, by the database clock), keeping each use's dates, class, publish state, lab networks and course-outcome tags; uses that have opened stay as they were. The save says how many it updated and kept.
- Platform templates are shared like library items (`content_shares` with `item_type = 'template'`, new ones reach every college); colleges use them or copy them to change. Items of a template (even assessment-only platform problems) may go into its uses; they still can't be put into other work. Problems and questions already on an assignment stay allowed when it's edited, and the form shows their titles even if its picker no longer offers them (`chosenProblems`).
- Changing who an item is shared with isn't an edit: it doesn't change `updated_at`, so open editors don't get a false conflict.

## Courses

- A course (`courses`, `features/courses`) is written once by an owner (the platform or a college) under Courses: an ordered outline of modules (`course_modules`), each an ordered list of library problems and questions (`course_items`). The list is compact; each module is edited in a dialog, and the outline is saved as a whole (`saveOutline`, which keeps module ids so progress follows them; stale saves get `edited_elsewhere`).
- A course holds practice nobody marks: public library problems (always allowed, shared or not), other ready listed problems the owner may use (members-only ones only its own), and ready questions that mark themselves. Drafts, assessment-only problems and written questions are refused.
- Platform courses are shared like library items (`content_shares` with `item_type = 'course'`; new ones reach every college). A college gives its own or shared ready courses to classes, or copies a shared one to change it (`copyCourse`; items stay the shared ones).
- A class gets a course from a start day (`course_classes`) on its Course tab, by whoever may set assignments for it; groups inside the class get it too. Release rules (`packages/judge/src/course.ts`, unit-tested): a module opens `openAfterDays` after the start, and with `afterPrevious` only once the student finished the module before. Teachers see every module and how many students finished each; students see modules as they open.
- Progress is computed: a problem is done with an accepted graded submission, a question with a right practice answer (`practice_answers`, one row per student and question; tries again allowed, a right answer stays right; the answer and explanation show once right or after 3 tries). Practice is never graded. A course in use can't be deleted (`course_in_use`); taking it off a class keeps students' work.
- The platform's units became its first course, "Programming fundamentals" (migration 0031 and the seed).

## Kinds of organization, modules and the sidebar

- **Every organization is one kind, chosen at creation and never changed.** The kinds are school, college, coaching institute, cohort program, company, community and other.
  - `updateSettings` refuses a different `type` (409 `kind_locked`), platform admins included, and Settings shows the kind read-only.
  - The create form (Admin › Organizations) and school sign-up use `KindPicker`, which shows each kind, what the chosen one decides, and a warning. Create stays off until "I understand this can't be changed" is ticked.
- **Each kind is one file in `packages/judge/src/kinds/`** (a `KindDefinition`), the only place a kind's differences live:
  - its label, the noun its people use ("the institute"), a description, examples, and what it decides (shown before creating);
  - its words (`terms`: learner(s), instructor(s), guardian(s), group(s), group lead, period(s), assessment(s));
  - its group levels (school Grade › Section, college Department › Batch, coaching Course › Batch, cohort Cohort › Pod, company Department › Team);
  - the modules it can support (`capabilities`) and those on from the start (`defaults`);
  - its role names: built-in roles are named Faculty, Mentor, Manager, Learner and so on at creation, with the same permissions.
  - `ORG_TYPE_CONFIG`, `kindTerms()` and `KINDS` derive from these files.
  - **To add a kind:** write its file, add it to `KINDS` and `ORG_TYPES` in the same order, and add its key to the `org_type` enum (a migration). `org-types.test.ts` checks the definitions agree.
- **Modules are decided in three layers** (`enabledModules(type, stored, policy)` in `org-types.ts`, unit-tested):
  1. the kind's capabilities: a module it can't support is never on;
  2. the platform's policy for the kind (`org_kind_policies`), set in **Admin › Organization kinds** by staff with "Manage organization kinds" (`platform.kinds.manage`): each capable module is off, optional, or on from the start, for every organization of the kind at once;
  3. the organization's own choices (Settings › Modules, from `moduleOptions()`), within what's optional or on.
  - A module not `ready` is never on.
  - Policies are read through a 30-second cache (`kindPolicies()` in `features/orgs/kinds.ts`), cleared when they change.
  - The org context carries the result as `ctx.modules`; use it (or `modulesOf(org)` / `kindPolicies()` outside a context), never `enabledModules` without the policy.
  - Policy changes are audited (`platform.kind_policy`).
- **The sidebar is data:** `ORG_NAV` in `packages/judge/src/navigation.ts` lists each page with its group, the permissions that reveal it (any of), the kinds it applies to, an optional `module`, and labels.
  - A `term` names it in the kind's words (Students → Learners, Academic years → Sessions).
  - `visibleOrgNav()` filters by permission, kind and modules, and names the groups per kind (`navGroupLabel`: "School" becomes College, Institute, Program; "Academics" becomes Learning for companies and communities).
  - The frame and homes use the kind's words and noun (`orgShell().terms` and `.noun`, `orgHome().terms`).
  - A new page is one entry there, never a hand-written link.
- **A link leads only where the person can go.** Links, cards and buttons follow the same rules as the pages and APIs they lead to.
  - **Whole-organization pages.** `wholeOrg: true` on an `ORG_NAV` item means its permission must be held across the organization, not just in a group. Roles is one: a class teacher sees their class's members, but not the organization's roles. `visibleOrgNav` checks it with `canWholeOrg`; the shell sends `wholeOrg` (the permissions held across the organization).
  - **Organization home links.** Home cards, shortcuts, the setup checklist, "Needs attention" and to-dos link to a management page only if the sidebar opens it:
    - in the browser, `useOrgReach(slug).manages(key)`;
    - on the server, `reachable(ctx, items)` in `features/home/server.ts`.
    - Never gate a link on one permission or module by hand.
  - **Kinds and modules on homes.** Home cards for a switched-off module aren't shown (attendance, timetable). Their words are the kind's (`terms.groups`, `terms.learners`).
  - **Buttons on the shared admin screens.** `useOwner().can(orgPermission, platformPermission)` decides a button such as New assignment, New contest or New problem.
    - Per-item rights come from the server. The assignments list has `canEdit` on each row; a row that can't be edited links to its gradebook. The gradebook has `can` (edit, rejudge, release, forgetAddresses, export, peer, sendGrades); each button and panel shows only where its action is allowed.
  - **Several platform permissions on one route.** `route({ access: [...] })` takes a list (any of them). Library pages open to writers and editors (`platform.library.create` or `.edit`), not only `.manage`. The plagiarism check's problem and contest lists open to `platform.submissions.view`.
  - **Refusals show a page.** A query refused with 403 or 404 before it has data is thrown to the nearest `error.tsx`: at the root, `/orgs/[slug]`, `/orgs/[slug]/manage` and `/admin`. These show `ErrorView` ("You don't have access to this", "Not found"), never an endless skeleton.
    - An optional widget whose data may be refused sets `throwOnError: false`.
    - A 403 or 404 isn't retried.
  - **Redirected pages.** `/orgs/:slug/manage` goes to `/orgs/:slug`, the organization's one dashboard. `/orgs/:slug/manage/teaching/:group` goes to the class page's "Syllabus and log" tab.
  - **Coding lab module.** `coding` covers assignments, contests, problems, questions, templates and the library. It's on by default for every kind, so existing organizations keep it, and an organization can switch it off in Settings.
    - Switched off, its sidebar items, the student "Coding lab" group, and the New assignment and New contest buttons go.
    - The content API refuses listing and writing new work (`needCoding()` in `features/orgs/content.ts`; 404 `module_off`).
    - Gradebooks and students' own past work stay readable.
  - **Members list.** `GET /orgs/:slug/members` returns everyone, with no cap, for pickers and integrations. With `?page=` it returns 100 at a time: `{ members, total, page, pages, counts }`, with counts by kind (staff, learner, parent, other) across all of them. `?kind=` filters by kind on the server. The Members screen uses the paged form.
  - **Long lists page on the server.** Members (100), parent links (100, searched) and the platform's organizations (50, searched in SQL) take `?page=` (and `?q=`) and answer `{ …, total, page, pages }`. Without a page they answer the whole list as before, for pickers and integrations. Screens use the shared `Pager` (`features/admin/components/shell.tsx`) and dim the list while the next page loads.
  - **The problem library is not paged on the server.** It sends compact index rows and shows 100 at a time with "Show more", because its filters (collections, sources, status) all work in the browser.
  - **Sidebar groups fold.** Every group starts open; its heading folds it, and the choice is remembered per device and per navigation (`useFolded` in `components/app-frame.tsx`). A folded group still shows the page you're on.
  - **Data screens.** A list's figures go above it in one line (`Stats` in `features/admin/components/shell.tsx`), not as a row of tiles, and percentages in tables are `PercentBar`s. Used on Reports, the gradebook, marks entry and the attendance overview.
  - **Tests.** `e2e/access-links.mjs` covers this. A crawl of the demo accounts (`pnpm --filter @workspace/db demo`) should find no 403 or 404 behind any link.

## Attendance (module)

- On by default for schools, colleges and cohorts; switched in Settings › Modules. Its pages: Teaching › Attendance (the register) and Reports › Attendance report (the month). With the module off, its API answers 404 and the sidebar hides it.
- A register is a teaching session of kind `register` (no minutes or topics), one per group, day and period (`period` "" = whole day; a partial unique index enforces it). Attendance taken while logging a class (`kind` `class`) shares the same `attendance` table, so the class summary, early warnings and the low-attendance reminder count both. Teaching views (the log, coverage, reports, feedback, the class stream) read only `kind = 'class'`.
- Marks have a `status`: present, absent, late, excused; `present` is kept in step (present or late). Excused is left out of every percentage (`summarizeAttendance` in `packages/judge/src/attendance.ts`, unit-tested).
- Permissions: "Take attendance" (`attendance.mark`) and "See attendance" (`attendance.view`), scoped to groups; the Teacher role has both. Students see only their own figures on the class page. A register can't be taken for a day that hasn't come (site timezone) or for anyone who isn't a student of the group; saving replaces the marks and is audited (`attendance.take` / `attendance.correct`).

- **Registers by course** (colleges' course-wise attendance):
  - A register may be for a course (`teaching_sessions.subject_id`, one of the courses the class or its grade takes; 400 `not_a_course` otherwise). The unique register is per group, day, period and course.
  - The register page offers a Course picker when the class takes courses.
- **The minimum to sit exams:** `module_settings.attendance.minPercent`, 75 by default (`readAttendanceSettings`). Set by those who manage settings, on the report's "By course" tab.
  - `courseAttendance()` counts each student's attendance per course over the term under way (the academic term whose dates include today, else the current year). It marks each eligible, at risk (within five points), or short, with `classesToReach()` (classes in a row to reach the minimum).
  - `eligibility()` and `classesToReach()` are in `attendance.ts`, unit-tested.
  - Students see their own per course on their home ("Attendance by course"), with how many classes they need.

## Subjects (module)

- On by default for schools and colleges. Manage › Subjects lists the organization's subjects (`subjects`: name, optional code unique per org, case-insensitive) and, for each, the classes that take it and who teaches it there (`class_subjects`, one per group and subject). Adding to a class and choosing its teacher happens in a dialog; the teacher must be someone given teaching for that class (`teachersOfGroup`). Deleting a subject takes it off every class.
- Permissions: "Manage subjects" (`subjects.manage`) with Add, Edit, Delete (organization-wide) and "Assign subjects to classes" (`subjects.assign`, scoped to groups) under it. Changes are audited (`subject.create/update/delete/assign/unassign`). `subjectsOfGroups()` feeds the class page and the timetable.

## Timetable (module)

- On by default for schools and colleges. One set of periods per organization (`timetable_periods`: name, `starts`/`ends` as "HH:MM", break or not, position) and the school days (`organizations.module_settings.timetable.days`, ISO weekdays, Mon–Fri by default; `readTimetableSettings`). A class's week is cells (`timetable_slots`: one per group, day and period) holding one of that class's subjects (`class_subjects`), so the teacher comes from Subjects.
- Rules (packages/judge/src/timetable.ts, unit-tested): a period starts before it ends; a cell can't be a break or a day off; a teacher can't be in two classes in one period (`teacherClash`, 409 `teacher_busy`). Saving periods keeps them by id, so cells survive; a period removed or turned into a break loses its cells.
- Permissions: "Manage timetables" (`timetable.manage`) with "Periods and days" (`timetable.periods`, organization-wide) and "Edit class timetables" (`timetable.edit`, scoped to groups). Audited as `timetable.periods` and `timetable.slot`.
- Pages: Manage › Timetable (a "Periods and days" dialog; pick a class, fill its grid), Manage › My timetable for teachers (`/timetable/mine`), and a read-only Timetable tab on the class page for anyone who teaches or sits in it (outsiders get 404, as for the class).

## Parent accounts (module)

- On by default for schools; available to colleges and cohorts. A parent is linked to a student in one organization (`guardians`: org, parent, student, relation). The link is all they have: a parent isn't a member, holds no role, and sees only that student, read only. `childOverview` builds their page by calling the student's own functions *as the student* (`classAttendance`, `classTimetable`, `classStream`, `listAssignments`), so a parent never sees more than their child does. Not their child, or the module off, is the same 404.
- Linking: Manage › Parents, one at a time (student search, then the parent's email, found or created like any invite) or from a pasted list (student email, parent email, name, relation; a report per line). Permissions: "Manage parent accounts" (`parents.manage`) with "See parents" (`parents.view`, the Teacher role has it) and "Link and unlink parents" (`parents.link`), both scoped to the students' groups. Audited as `parent.link/unlink/import`.
- Notifications: `notify()` copies what a student is told about new work, marks, extensions, notices and teachers' notes to their parents (`tellParents`, event `parent.updates`, one per child, linking to the child's page). Saving a register tells parents when a child becomes absent, for today or yesterday only, once per register (`parent.absence`). Both are "To parents" events, shown in notification settings only to people who are parents.
- Parents find their children at /children ("My children" in the header, from `/me`'s `parent`) and each child at /orgs/:slug/children/:studentId.

## Library (module)

- Off by default; schools and colleges switch it on. Code is `features/books` (the content library of problems and questions is `features/library`, a different thing; the sidebar calls this one "Books", under Campus). `library_books` holds titles with a number of copies; `library_loans` holds loans (`issued_on`, `due_on`, `returned_on` as "YYYY-MM-DD" in the site's time zone; status out, returned or lost). Rules (packages/judge/src/library.ts, unit-tested): loan days and books per person live in `module_settings.library`, defaulting to 14 and 3. A person can't borrow the same book twice, a book with no free copy, or more than the limit. Issuing locks the book row, so two desks can't lend its last copy together. Marking a book lost closes the loan and removes one copy. Copies can't go below the number on loan, and a book on loan can't be deleted.
- Permissions are organization-wide: "Run the library" (`library.manage`), with "Keep the catalog" (`library.catalog`: books, lists, loan rules) and "Lend and take back books" (`library.lend`: issue, renew, return, lost). Everything is audited as `library.*`.
- Members browse the catalog and see their loans at /orgs/:slug/books. The bell reminds them when a book is due within a day or overdue (`library_due`, worked out when read). Their books also show on My classes and on the child page parents see, through `features/campus` (`campusOf`), which Transport and Hostel extend.

## Transport (module)

- Off by default; schools and colleges switch it on. `transport_routes` holds the vehicle, driver and seats (null means no limit). `transport_stops` are kept in pick-up order, each with an optional morning pick-up and afternoon drop-off time. `transport_riders` gives one route and stop per person per organization. Rules (packages/judge/src/transport.ts, unit-tested): stop names are needed and distinct; pick-ups run forward along the route and drop-offs run back from the last stop. Placing a rider locks the route row, so two people can't fill its last seat together; moving someone's stop doesn't count them twice. Saving a route keeps stops by id, so riders keep their stop. Seats can't go below the number of riders, and a stop someone uses can't be removed.
- Permissions: "Run transport" (`transport.manage`), with "Set routes and stops" (`transport.routes`, organization-wide) and "Assign riders" (`transport.assign`, scoped to the riders' groups through `features/campus/people.ts`, shared with Parent accounts). Changes are audited as `transport.*`. Riders can be added from a pasted list (email, route, stop; names matched ignoring case), with a report per line.
- A rider is told when they're put on a route or taken off (event `campus.update`, kind `transport`, copied to their parents). Their bus shows on My classes and the parent's child page (`campusOf` → `transport.ride`).

## Hostel (module)

- Off by default; schools and colleges switch it on. The data is `hostels` (who it's for, warden), then `hostel_rooms` (name, floor), then `hostel_beds` (lettered A, B, C… and on past Z), then `hostel_residents`. Unique indexes allow one bed per person per organization and one person per bed, so a race to fill a bed ends in a 409 `taken`. Rules (packages/judge/src/hostel.ts, unit-tested):
  - Rooms are added in runs (prefix plus a number range, at most 200 at a time), and names already there are skipped.
  - Fewer beds removes the last letters, never an occupied bed.
  - Rooms and hostels can be removed only when empty.
- Permissions:
  - "Run hostels" (`hostel.manage`) has two parts. "Set hostels, rooms and beds" (`hostel.rooms`) is organization-wide. "Allot beds" (`hostel.allot`) is scoped to the residents' groups.
  - Someone with only "Allot beds" sees the names of their own groups' residents. Other beds show just as taken.
  - Beds can be allotted from a pasted list (email, hostel, room, and optionally a bed; with no bed, the first free one is used).
  - Changes are audited as `hostel.*`.
- A resident is told when they get a bed, move, or move out (`campus.update`, kind `hostel`, copied to their parents). Their bed shows on My classes and on the parent's child page (`campusOf` → `hostel.stay`).

## Two-factor sign-in

- **Email and password, beside Google** (`features/auth/password.ts`, the `password` credentials provider in `features/auth/options.ts`). Sign-up (`/sign-up`) makes an account whose address isn't confirmed; a link (24 h, single-use) confirms it on `/verify-email` with a button press, so mail scanners opening the link don't use it up. Password sign-in works only once confirmed. Google sign-ins count as confirmed; if the account had a password nobody had confirmed yet, Google confirming the address drops that password and its links (against pre-hijacking: someone signing up first with another person's address). `/forgot-password` emails a one-hour single-use link to `/reset-password`, which sets the password, confirms the address, clears any pause and signs out every older session (`users.sessions_valid_after`, checked against the session's `signedInAt` in `readSession`). Account › Security adds or changes a password (changing needs the current one) and signs out everywhere. Every change emails the owner a security notice and is logged (`account.*`).
- Passwords: scrypt (N=2^15, r=8, p=1), parameters stored with the hash; rules after NIST SP 800-63B in `packages/judge/src/passwords.ts` (at least 10 characters, not common, not a run, not the email's name; no composition rules). Five wrong in a row pause password sign-in for 15 minutes (Google still works) and email the owner. Answers never reveal whether an address has an account: sign-up, "forgot" and "resend" always say to check your email (the email says what happened), and unknown addresses take as long as wrong passwords. Links: 32 random bytes, only their SHA-256 stored, one live per kind, at most one email a minute per address. API responses drop any `passwordHash` field (`lib/api/route.ts`) as a safety net.
- After the password or Google, a second step (Account › Security). The methods are **an authenticator app** (TOTP, RFC 6238: SHA-1, 30-second steps, 6 digits, one step of drift) and **codes by email** (6 random digits, 10 minutes, single-use), on alone or together, plus ten one-time **backup codes** that come with the first method. Code rules live in `packages/judge/src/totp.ts`, a server-only entry point (`@workspace/judge/totp`; it uses node:crypto), tested against the RFC's own values. Never export it from the judge index, which browser code imports.
- Storage (`two_factor`): the app secret is sealed with AES-256-GCM under a key derived from NEXTAUTH_SECRET (changing that secret means setting the app up again). Backup and emailed codes are hashed. `last_step` stops an app code being used twice. Emailed codes go at most once a minute and five an hour. Five wrong codes of any kind lock the step for 15 minutes. App setup keeps its secret in `pending_*` until a code confirms it.
- **The session is a JWT.** Codes are checked in NextAuth's jwt callback (`features/auth/options.ts`: `secondStep`, `confirmApp`, `confirmEmail`), reached by POSTing the session update (`features/auth/session-step.ts`). Only a right code writes `mfaAt` into the signed cookie; never a client-sent flag. `readSession()` (`features/auth/current-user.ts`) counts someone with two-factor on as signed in only when `mfaAt` is at or after `enabled_at`, or when their browser holds a valid trust cookie. Otherwise they're `pending`: signed out for every page and API, and `/me` says `twoFactorPending`.
- Every sign-in goes through `/sign-in/continue?next=`: straight on, or the second step (app, "Email me a code" via `POST /auth/two-factor/email`, which acts only on the pending session's person, or a backup code), then a full page load of `next`.
- **"Don't ask again on this browser for 30 days":** `gl-2fa-trust`, an httpOnly cookie signed (HMAC) over the person, its expiry, `trust_version` and `enabled_at`. "Forget trusted browsers" raises the version; turning two-factor off and on voids it too.
- Removing a method, or making new backup codes, needs a current code from any method (the dialog can email one). Removing the last method turns two-factor off.
- Emailed codes and security notices are **urgent** in the outbox (`email_outbox.urgent`): claimed ahead of everything else, so a backlog of notices never delays them. A code is sent before the request answers (`sendUrgent()`, which sends only urgent email), carries `expires_at` (its 10 minutes), and is dropped rather than sent late. If the provider refuses it, the request says so and the outbox keeps retrying while the code is good.
- Every change is emailed to the person ("Security: …", urgent) and logged on the platform under Security: `security.2fa_on/method_add/method_remove/2fa_off/backup_code/backup_codes/forget_browsers/2fa_reset`.
- Platform setting `security.require_2fa` (off, staff, everyone; staff means platform staff or anyone holding an organization role that grants something). Someone required to use it who hasn't turned it on gets 403 `two_factor_required` from every API route except those marked `beforeTwoFactor` (their security page), and a banner explains why. Their last method can't be removed. An admin can't require it before turning it on for themselves.
- Lost every method and code: platform staff with "Manage users" turn their two-factor off from Dashboard › Users. That's refused for someone with more access than you, and never for yourself; the person is emailed. If every admin is locked out, delete their `two_factor` row in the database.

## Audit log

- One table (`audit_log`) for organizations (`org_id` set) and the platform (null). Always write entries through `writeEntry` in `features/audit/server.ts`; inside organizations, use the `audit()` / `writeAudit()` wrappers, which call it. Each entry records:
  - **Who:** `actor_id`, plus `actor_label` ("Name <email>" as it was then, so an entry still reads correctly after the account is deleted).
  - **What:** `action` such as "role.update", and its `category` (the first word, named in packages/judge/src/audit.ts).
  - **A sentence and details.**
  - **Where from:** `ip` and `user_agent`.
  - **`support`:** platform staff acting inside an organization they aren't an active member of.
- The address and browser come from `lib/api/request-context.ts`: `route()` stores them per request (AsyncLocalStorage), so no call site passes them. The address is recorded only when `lib/api/client-ip.ts` can trust it; a claimed `X-Client-IP` without the proxy secret is ignored. Outside a request (scripts, cron) both are empty.
- Edits that matter record what changed, in `detail.changes` (`{field, from, to}` from `changesBetween`) and `detail.lists` (`{label, added, removed}` from `listChanges`), using labels people read rather than keys. Current examples are organization settings (fields and modules), and roles in organizations and on the platform (name, description, permissions by label). Add the same to any new edit that changes several things.
- Reading: `readAudit(orgId | null, filters)` returns a page, newest first: `q`, `category`, `actor`, `from`/`to` (days), `before` (the last entry's "time|id"), and `limit` (default 50, at most 200). It also returns the areas and people to filter by. Malformed filters are a 400. `auditCsv` downloads up to 10,000 entries; fields that look like formulas are made safe, and the download itself is logged. Manage › Activity and Dashboard › Activity both use `AuditLog` (`features/audit/components`).

## Student records (module)

- On by default for schools and colleges. The tables:
  - `academic_years`: name, `starts_on`/`ends_on` as "YYYY-MM-DD". A partial unique index allows at most one current year per organization.
  - `student_records`, keyed by org and user: admission number (unique per org), gender, and `birth_date`, `phone`, `address` sealed with `lib/sealed.ts` (AES-256-GCM, a key per purpose derived from NEXTAUTH_SECRET).
  - `enrolments`: one per student per year, holding the group (a leaf, a section), a roll number, and a status of active, transferred, graduated or withdrawn.
  - Rules are in `packages/judge/src/records.ts`, unit-tested.
- **Places follow the current year.** The current year's *active* enrolments are the students' rows in `group_members`, so registers, timetables, class pages, parents and homes need no change.
  - `features/records/server.ts` rewrites them whenever a student is placed, moved, withdrawn or restored (`place`), and for everyone when another year becomes current (`syncPlaces`).
  - Students with no enrolment in the new current year are left without a class. Their history stays.
  - Never edit a student's `group_members` around this module; go through it.
- **Students who don't sign in** (young children) still get a user: `noLoginEmail()` is on the reserved `.invalid` domain, which Google can't sign in to. `queueEmails` drops every `.invalid` address, so nothing ever mails them. Such a student can later be given a real email to sign in with.
- **Permissions:**
  - "Manage student records" (`students.manage`) has three finer actions under it:
    - "See student records" (`students.view`, which the Teacher role has);
    - "Add and edit students" (`students.edit`). Both are scoped to the students' groups; students without a class count as organization-wide.
    - "Academic years" (`students.years`, organization-wide).
  - Placing a student needs a current year and a section (a group with nothing inside).
  - Changes are audited as `records.*`. Personal details are logged only as "changed", never their values.
- **Promotion** (Manage › Academic years › Promote students; `promotion` in `features/records/server.ts`):
  - Pick a from-year and a to-year. Each section of the from-year is suggested a destination by `suggestPromotion` (the same-named section of the next grade, else that grade's first section; the top grade graduates). A section can instead repeat, graduate or withdraw, and single students can be made exceptions.
  - A preview counts moved, repeated, graduated, withdrawn and skipped (already enrolled in the to-year), so running it twice is safe. Applying writes to-year enrolments and graduated/withdrawn statuses in one transaction, optionally makes the to-year current, and is audited as `records.promote`.
- **Import** (Manage › Students › Import): a CSV file or pasted text. Every row is checked first (name, email, gender, day-first birth date, class path to a section the importer may edit, roll, unique admission number) and nothing is written unless all rows pass; then all are added in one transaction (`records.import`).
- **People already in classes without a record** (from before the module) show as a banner on Manage › Students; "Create records" gives each an admission number and a current-year enrolment (`records.adopt`).
- **Pages:** Manage › Students (search by name, email or admission number; filter by class (a grade includes its sections) and status; pages of 50; a sheet to add or edit), Manage › Students › one student (details, parents, attendance, campus, class by year; mark transferred, graduated or withdrawn, or back), and Manage › Academic years. The admin home's checklist gains "Current academic year".

## Exams and report cards (module)

- On by default for schools and colleges; needs Student records and Subjects on (otherwise the API answers 409 `needs_modules`). Code in `features/results` (the lab's timed exams are `features/exams`, a different thing). Rules in `packages/judge/src/results.ts`, unit-tested: the grading scale (CBSE's A1–E by default, kept in `organizations.module_settings.exams.scale`), marks (whole or half, up to full marks), a paper's outcome, an exam's total, percentage, grade and result (an absence is 0 and a fail; any unmarked paper makes it "incomplete"), the year's weighted result, and competition ranks.
- Tables: `term_exams` (an exam in an academic year, with an optional weight toward the year's result and `published_at`), `exam_papers` (one per exam, section and subject: full and pass marks, the day), `exam_marks` (per paper and student: marks or absent).
- **Who sits a paper comes from the exam year's enrolments**, not today's classes, so last year's results stay right after promotion. Anyone who already has marks stays on the sheet even if they left.
- Adding papers: choose sections or grades (a grade means each section). Each gets a paper for every subject it takes, including subjects given to its grade. Existing papers are left alone, so it's safe to run again.
- **Permissions:**
  - "Manage exams and results" (`exams.manage`) has three finer actions under it:
    - "Set up exams" (`exams.setup`, organization-wide): exams, papers, the scale, publishing;
    - "Enter marks" (`exams.marks`, scoped to groups): for an exam cell or a class teacher;
    - "See results" (`exams.view`, scoped; the Teacher role has it).
  - A paper's subject teacher (Subjects module) can always enter its marks, and no other subject's.
  - Students and their parents see only their own report card, and only published exams. Staff see drafts, marked as drafts. Anyone else gets 404, so they can't tell a student exists.
- **Publishing** refuses while marks are missing (409 `incomplete`) unless forced. It tells each student (kind `results`, under "Marks and feedback"), and their parents get a copy. While an exam is published its marks, papers and the exam itself are locked; unpublishing unlocks them.
- Audited as `exam.*`. A change to a mark already entered is logged as `exam.marks_correct`, separately from first entry.
- **Class teachers and remarks:**
  - Each section has a class teacher per academic year (`class_teachers`), chosen on Manage › Academic years › Class teachers by someone with "Academic years". They're picked from people teaching the section (`teachersOfGroups` in `features/classes/server.ts`, one query for many groups).
  - `report_remarks` holds two kinds:
    - the overall remark per exam and student (no paper), written by the class teacher, "Set up exams", or "Write remarks" (`exams.remarks`, scoped, for a coordinator);
    - a subject remark per paper and student, written with the marks by whoever may enter them.
  - Both have partial unique indexes, so saving deletes then inserts in one transaction. Saving an empty remark removes it. Remarks lock when the exam is published, and show on the report card with the class teacher's name.
  - The comment bank lives in `module_settings.exams.remarks`; there are defaults in `DEFAULT_REMARKS`, cleaned by `cleanRemarkBank`. `{name}` becomes the first name (`fillRemark`). Audited as `exam.remarks`, `exam.remark_bank` and `records.class_teachers`.
- **Pages:**
  - Manage › Exams: the year's exams, the grading scale, adding an exam.
  - An exam: papers by class with marking progress, adding papers, publishing; a Results tab with each class's table, stats and ranks.
  - Marks entry (`/manage/exams/[id]/papers/[paperId]`): Enter moves to the next student, bad marks are flagged before saving, and leaving with unsaved marks warns.
  - The report card at `/orgs/[slug]/results/[studentId]` (`me` for your own): printable. Linked from the student's sidebar (Results), the parent's child page and the staff student profile.

- **Grading by kind** (`KindDefinition.grading`): schools, coaching institutes and other organizations grade by marks (the CBSE scale by default); colleges by credits (the UGC ten-point scale O, A+, A, B+, B, C, P, F by default; `defaultScale`, `readExamSettings(…, grading)`).
- **Terms** (`academic_terms`, "Semesters" in a college, "Terms" in a school, from the kind's `terms.parts`):
  - Managed on the Exams page (add, rename, remove). Removing one leaves its exams without a term.
  - An exam may belong to a term (`term_exams.term_id`, which must be in the exam's year).
- **Credits** (colleges): courses (`subjects.credits`, whole or halves up to 40) carry credits.
  - In each term, a course's percentage is that term's exams weighted (averaged when none has a weight), graded on the scale with its points.
  - The term's SGPA is credits × points over credits, to two decimals. A course at 0 points (F) is a backlog and its credits aren't earned.
  - The CGPA weighs every term so far by its credits, from the years the viewer may see.
  - `sgpa()`, `cgpa()` and `creditsProblem()` are in `results.ts`, unit-tested. `reportCard().credits` carries the year's grade cards and the CGPA.
  - The report card page and its PDF show a grade card per term (code, course, credits, grade, points; SGPA, credits earned, backlogs) and the CGPA above the marks. A class's PDF shows the grade cards without the CGPA.
- **The kind's words on the pages:** Exams is titled with `terms.assessments` (Assessments, Tests), Students with `terms.learners`, Academic years with `terms.periods`.

## Leave (module)

- On by default for schools and colleges. Code in `features/leave`; rules in `packages/judge/src/leave.ts`, unit-tested. The rules cover school days in a span (the timetable's days, Mon–Fri by default), half days (0.5), a request's limits (at most 90 days at once, at most 30 days after the fact), overlaps, staff leave types and balances.
- One table, `leave_requests`. A request has a `kind`:
  - `student`, asked by the student or a linked parent. Its `type` is a reason: sick, family, event or other.
  - `staff`, asked by the staff member themselves. Its `type` is a key of the school's staff leave types (`module_settings.leave.types`: Casual 12, Sick 10, Earned 15 and Unpaid with no limit by default).
  - `days` is counted when the request is made.
  - Status goes pending → approved or rejected, or cancelled (taken back while waiting, or before approved leave starts).
- "Staff" means an active member holding any permission (`heldAnywhere`). A student asking without naming anyone asks for themselves.
- **Who decides:**
  - Student leave: the current year's class teacher of the student's section (`class_teachers`), or "Approve student leave" (`leave.students`, scoped).
  - Staff leave: "Approve staff leave" (`leave.staff`, organization-wide), which also sets the kinds of leave.
  - Nobody decides their own.
  - Notifications go to the class teacher (else the school-wide approvers) and to the office. Kinds are `leave_request` and `leave_decision`, in events `leave.request` and `leave.decision`.
- **Balances** count approved and waiting staff days in the current academic year (else the calendar year). A request beyond what's left is refused (409 `not_enough`), and overlapping leave is refused (409 `overlaps`).
- **Attendance:**
  - Approving student leave turns that student's `absent` marks in those days into `excused`.
  - `getRegister` returns `onLeave` per student, and the register starts them as excused with an "On leave" tag.
  - `saveRegister` doesn't send parents an absence alert for a day their child is on approved leave.
- The sidebar has Leave under "This school" for everyone, with a count of requests waiting for you (`orgShell().leavePending`). The page has tabs: To decide, Mine, Decided (filtered by status and student/staff, 50 a page). Audited as `leave.*`.

## Staff attendance (module)

- Module key `staffAttendance`, on by default for schools and colleges. Code in `features/staff-attendance`; rules in `packages/judge/src/staff-attendance.ts`, unit-tested: statuses, a check-in's status against the late time, the time in the site's timezone (`timeIn`), settings, and a month in numbers (leave left out, a half day counts half).
- `staff_attendance` stores one row per org, person and day: a status (present, late, half_day, absent, on_leave), the time they came in, a note and who marked it.
- "Staff" means active members whose roles grant something, so students (Member role or no role) never show.
- **Permissions:**
  - "Take staff attendance" (`staff_attendance.mark`, organization-wide): marks a day (only the people sent are changed; no future days) and sets the late time and whether staff may check themselves in (`module_settings.staffAttendance`, late after 09:00 and self check-in on by default).
  - "See staff attendance" (`staff_attendance.view`) shows the register and the month.
- **Self check-in** (`POST staff-attendance/me/check-in`) works for today only, once (409 `already_marked`, including when the office has already marked them). It's late after the late time.
- **Approved staff leave** (Leave module) shows on the register as "On leave", starts the person as on leave, and fills the month report.
- **Pages:**
  - Manage › Staff attendance: a Day tab with buttons per person, the time in and a note; a Month tab with a grid, totals and %.
  - My attendance (`/orgs/[slug]/my-attendance`) for every staff member: today's check-in and their month. Audited as `staff_attendance.*`.

## Admissions (module)

- On by default for schools and colleges; needs Student records. Code in `features/admissions`; rules in `packages/judge/src/admissions.ts`, unit-tested: statuses and the moves the office may make, settings, what an application must say, and `APP-YYYY-NNNN` numbers (per year applied for, taken under a row lock on the organization).
- **Settings** (`module_settings.admissions`): open or closed, the academic year applications are for, the classes (top-level groups, none chosen: all) and instructions. When open, the public page shows "Apply for admission" (`getOrganization().admissionsOpen`).
- **Applying:**
  - Applicants sign in (Google), which keeps out anonymous spam and gives the account that becomes the parent. They apply at `/orgs/[slug]/apply`, even if they aren't members.
  - Limits: one open application per child (same name and birth date) and five open at once. Applicants see their applications and can withdraw them while undecided.
  - `admission_applications` seals birth date, phone and address (`lib/sealed.ts`, purpose "admission").
- **The office** ("Manage admissions", `admissions.manage`, organization-wide):
  - Manage › Admissions: open or closed, status counts, a class filter, search, pages of 50, and a sidebar count of new applications (`orgShell().admissionsNew`). The admin home flags them in "needs attention".
  - An application's page moves it to reviewing, waitlisted or not admitted, with a message the applicant is told (`admission_update`). The office is told of new applications (`admission_new`).
- **Admitting** reuses Student records' `createInTx`, so it makes the same account, record, admission number and enrolment as adding a student by hand:
  - It enrols the student in the chosen section of the class applied for, in the application's year. They're placed in the class now only if that year is current; otherwise they join when it becomes current.
  - It links the applicant as parent (Parent accounts), and a student who applied for themselves (relation `self`) becomes their own record.
  - It runs in one transaction with the application locked. The link to the record shows only to people who can see student records. Audited as `admission.*`.
- `createInTx` now places a student (`group_members`) only for the current year; admitting into next year leaves today's classes alone.

## Registering a school

- The platform setting "School sign-up" (`orgs.self_signup`) is off (default), review or open.
- At `/schools/new` (linked from Organizations when allowed), a signed-in person registers a school, college or cohort and becomes its owner (`createOrgInTx`, shared with the admin's create).
- **Optional set-up** in the same step: the current academic year, and grades `from`–`to` with the same sections in each (for kinds with two group levels).
- **Review mode:** the organization starts inactive with `signup_status = 'pending'`. Platform admins are told (`school_signup`). Its pages answer 403 `pending_approval`, and the owner's profile says it's waiting. Approving in Admin › Organizations (activating a pending one) clears it, tells the owners (`school_approved`) and logs `org.approve`.
- Limited to three registrations a day per person (from the audit log), and taken addresses are refused.

## PDFs (report cards, transfer certificates, ID cards)

- Made on the server with `pdf-lib` (pure JavaScript, works on Vercel) through a small layout layer, `lib/pdf/document.ts`: A4 pages, wrapped text, label–value facts, tables whose header repeats on each page, the letterhead, lines to sign, and footers.
- **Fonts:** Noto Sans regular and bold are cut down to Latin, Latin Extended, punctuation and ₹, and embedded as base64 in `lib/pdf/fonts.ts` (in `.prettierignore`). Only the glyphs used are put in each PDF. A character the fonts lack prints as "?" (`printable`), so no name breaks a document.
  - Indic scripts aren't supported: pdf-lib doesn't shape text, so Devanagari would come out wrong even with the font.
- **Routes** answer `application/pdf` inline with `cache-control: private, no-store`, and are guarded exactly like the pages they print:
  - `report-cards/[studentId]/pdf` (`me` too): the report card, through `reportCard()`, so the family sees published exams only.
  - `report-cards/class/[groupId]/pdf?yearId&published=1`: every student of a section, through `classReportCards()`, for staff who may see the class; audited `exam.print`. `composeCards()` builds many cards from one pass over the class's results, so a class costs about what one student does.
  - `students/[id]/transfer-certificates` (GET list, POST issue) and `transfer-certificates/[id]/pdf`. Issuing needs "Add and edit students" for the student and is numbered `TC-YYYY-NNNN` under a row lock. What it says is kept sealed as issued (`transfer_certificates.details`), so reprints match. By default it marks the student transferred. Audited `records.tc` and `records.tc_print`.
  - `students/id-cards/pdf?groupId`: a section's current-year students, ten 85.6 × 54 mm cards to an A4 sheet; audited `records.id_cards`.
- **Buttons:** Download PDF on the report card page, "All report cards (PDF)" on an exam's Results tab, Transfer certificates on a student's profile (issue and print, and the list), and "ID cards (PDF)" on Students once a section is chosen.

## The member's home (/home)

- Signed-in people land on `/home` from `/`; visitors still go to the problems (or contests when practice is off). The header's main navigation starts with Home for signed-in people (Learn mode).
- `memberDashboard()` in `features/me/dashboard.ts` gathers, from what already exists:
  - their schools (`myOrganizations`, active ones, plus requests waiting) and children (`myChildren`);
  - work due (`listAssignments`: open and unfinished, due this week, overdue late work, the next five);
  - contests live or starting within three weeks (`listContests`);
  - practice (`getProfile`: solved by level, the streak, twelve weeks of activity, recent solves) and the daily challenge (`getDaily`).
  - A part whose site feature is off is left out, and a part that fails never breaks the page.
- The page (`features/me/components/home.tsx`) has a greeting, tiles (due this week, overdue, solved, streak), Due next with progress, Contests, Today's challenge, Practice with a heatmap, and the schools and children as cards.

## The school home and frame

- **The frame.** Every school page (the home at `/orgs/:slug` and all of `/orgs/:slug/manage/*`) sits in `OrgShell` (`features/home/components/org-shell.tsx`), built on shadcn's Sidebar (`packages/ui`):
  - full sidebar from 1024px, an icon rail with tooltips from 768px, a slide-out menu below that;
  - the header holds the school, your role here, the bell, the theme toggle and the account menu;
  - the menu groups are wrapped in `nav[aria-label="Organization"]` (tests use it).
- **The sidebar** comes from `GET /orgs/:slug/shell` (`orgShell` in `features/home/server.ts`): your views, roles, permissions and modules, pending join requests, and your children. Staff items come from `ORG_NAV` / `visibleOrgNav` (groups: People, Academics, Every day, Campus, Coding lab, School), filtered by permission and module. Students get their learning and coding-lab links, and parents a link per child.
- **Views** (`viewsOf`), in this order:
  - `admin`: holds an organization-wide `org.members.view`, `org.settings.manage` or `reports.view`;
  - `teacher`: a teaching role (`attendance.mark` / `teaching.log`) given for particular groups;
  - `student`: an active member sitting in a group and holding no permissions;
  - `parent`: linked to a child, with the Parent accounts module on.
- **The home** (`GET /orgs/:slug/home`, `orgHome`) computes only the views the person has, and someone with several switches between them with tabs. Everyone with a view gets the home at `/orgs/:slug`; visitors get the public profile. That profile also lives at `/orgs/:slug/about` (in the frame for people with a place there; "About the school" in every sidebar). It carries the member's own controls, so keep it reachable: sharing practice progress, leaving, the organization's notices, work, problems and contests, and rating classes.
  - **School view:**
    - the setup checklist, shown until every step is done, with steps only for modules that are on;
    - students, teachers, classes and present today. Students are members holding no role, and teachers hold a teaching role that isn't owner or admin;
    - attendance class by class today, the last ten days with registers (a shadcn Chart);
    - needs attention, coverage, and shortcuts limited by permission.
  - **Teaching view:** today's lessons from the timetable, registers to take, students below 75% (four or more marks), and their classes.
  - **Student view** ("My progress"): built by calling the student's own class functions as them (`classAttendance`, `classTimetable`, `classStream`, `listAssignments`, `listContests`, `campusOf`). It shows attendance across their classes, work due this week, today's lessons, what's coming up (work, contests within 14 days, library books), notices across their classes, and bus, room and library.
  - **Parent view** ("My children"): one card per linked child from `childOverview`, with attendance, an "Absent today" alert, open work, bus, the latest absences and notices, and a link to the child's page.
- Built only from shadcn components (Card, Badge, Progress, Chart, Empty, Skeleton, Tabs, Sidebar) and Gretlab's theme tokens. The sidebar and chart tokens are in `packages/ui/src/styles/globals.css`. Add components with the shadcn CLI from `packages/ui` and never overwrite existing ones.

- A fifth view, `staff`, is for active members whose roles grant something but who neither oversee the school (admin) nor teach a class (teacher): an office clerk who takes staff attendance or approves leave. Their home has today's check-in (Staff attendance module) and a card for each page their roles open (`visibleOrgNav`).

- The admin checklist also has class teachers (this year), this year's exams and admissions (a year chosen), each when its module is on. "Needs attention" also lists new applications and leave waiting for this person; an attention link may be a full `/orgs/...` path (leave lives outside Manage).

- **One frame for the working areas.** `components/app-frame.tsx` (AppFrame) is the shadcn Sidebar layout: full on laptops and PCs, an icon rail on tablets, a slide-out menu on phones, and a header with notifications, theme and account. `OrgShell` (navigation "Organization") and the platform admin's `AdminShell` (navigation "Dashboard", with "Back to the site") both hand it their own groups of links with icons. Change the frame there, not in each area.
- **The admin platform:**
  - The shared `Card`, `Table` and `Loading` in `features/admin/components/shell.tsx` have the shadcn card and table look and skeletons, so every admin page follows.
  - The overview has the platform's figures as tiles (people and new this week, organizations active and waiting, problems, contests), schools waiting for approval with Approve, two weeks of submissions as a chart, the last 24 hours by verdict, and the judge queue's health (`getOverview()` in `features/admin/server.ts`).
- **The teacher's home** also shows today's check-in (Staff attendance), marks still to enter in their own subjects (`papersToMark()`, current year's unpublished exams), and leave waiting for them as class teacher.
- **The staff home** has a greeting, today's check-in, tiles for what waits (leave to decide, new applications) and today's staff register (`staffToday()`), and their pages as cards with what each is for. Item links in the homes' lists may be full `/orgs/...` paths (the shared list handles both).

## Organizations and permissions

- The platform dashboard is run by platform staff roles (see "Platform staff and roles"; `users.role` is kept in step for older checks). Inside an organization, access comes only from organization roles.
- Permissions are a fixed list in `packages/judge/src/permissions.ts`; roles are bundles of them stored per organization. Built-in roles (Owner, Admin, Teacher, Member) can't be edited or deleted; organizations add their own.
- Some permissions are fine-grained actions under a coarse parent (`parent` field): assignments (create, edit, publish, delete, extend, grade), contests (create, edit, delete, grade), problems and questions (create, edit, publish, delete), notices (create, delete), groups (create, rename, delete), members (change groups, remove; assign roles, under "Manage roles"), and notification settings (under "Organization settings"). Platform roles split the same way (`packages/judge/src/platform.ts`, ancestor-aware `platformCan`/`grantsPlatformPermission`): the library and work (create/edit/publish/delete/grade), colleges (create, suspend), and staff-role assignment (under "Manage staff and roles"). Single-capability permissions (see members/grades, export, import, log teaching, reports, share content, activity log) stay whole. The role editors (organization: `features/orgs/components/permission-picker.tsx`; platform: the same component in the staff dialog) show a parent as a row you expand to reveal its actions, collapsed by default so the list stays short, with an "n of m" badge; a ticked parent grants and locks its children. Holding the parent grants every action beneath it, because `allows()` walks the chain (`grantsPermission`, `permissionWithAncestors`); so existing roles that hold a parent keep working unchanged, and `needSubset` lets a parent-holder hand out its children. The role editor shows children indented, and a ticked parent shows them granted and locked. Read and list checks stay on the parent; only the write verbs use the fine keys. Add a child by giving it a `parent` and refining the one mutation that enforces it; unit tests (`permissions.test.ts`) check the chain and that the built-in roles still reach every child.
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

- A class is a group someone teaches, at any level. `/orgs/[slug]/classes/[groupId]` gathers everything about it in tabs: Stream (class notices, logged classes, new work), Classwork (assignments and contests reaching it, syllabus), Course (its courses, with certificates for teachers), Discussion, People, Grades (with Needs attention for teachers), Syllabus and log (with attendance), Outcomes and Insights. Teachers of the group see all of it; students sitting in it or a group inside it see their side; everyone else gets 404. `features/classes/server.ts` holds the rules.
- Content reaches a class when one of its conditions names the class, a group above it ("From CSE") or a group inside it; organization-wide content reaches every class. Students still only see what `accessTo` lets them take part in.
- "New assignment" and "New contest" from a class open the form with `?for=<group>`: aimed at the class, and back to it after saving.
- Notices can be aimed at a class (`notes.audience`). A notice for the whole organization needs organization-wide "Post notices"; a class teacher posts from the class page and can remove only notices for groups they cover.
- Attendance is marked when logging a class, for people in that class only (`attendance` table). Below 75% shows red to the teacher and the student.
- Teach (`/teach`) lists a teacher's classes per organization as the group tree, with "Due this week" and "Behind the syllabus" first. Students' `/classes` lists the last-level groups they sit in. Assignments and contests link to the classes they're for (`classLinks`).

## LMS (LTI 1.3)

- An organization connects Moodle, Canvas, Blackboard or another LMS under Manage › LMS (organization-wide "Change settings"; audited), entering what the LMS gives it (issuer, client ID, deployment IDs, auth, token and keyset URLs, https in production; `LTI_ALLOW_HTTP=true` for local tests). The page shows the addresses to give the LMS: `/api/v1/lti/login`, `/api/v1/lti/launch` (also deep linking) and `/api/v1/lti/jwks`.
- Launch (`features/lti/server.ts`): login initiation stores a state and nonce (10 minutes, used once; a state cookie too, SameSite=None over https) and sends the browser to the LMS; the LMS posts a signed id_token back. It's verified RS256 against the LMS's keyset (cached 5 minutes, refetched once on a miss), then its claims (`packages/judge/src/lti.ts`, unit-tested: issuer, audience/azp, expiry with a minute's skew, nonce, LTI 1.3.0, a registered deployment, the message type). These endpoints are plain handlers (an LMS's cross-site POST would fail `route()`'s origin check) and answer errors with a short page.
- The person is found by their LMS id, then by email (an account is made if new; an LMS that doesn't share email can't bring new people), becomes an active member, and is signed in with the same session cookie Google sign-in makes. Each LMS course is recorded; an admin links it to a class on the LMS page. In a linked course, learners are placed in the class (its last-level groups) and instructors get the built-in Teacher role for it. A link opens its assignment (custom `assignment=<slug>` or an `/assignments/<slug>` target), else the class, else `/lti/unlinked`.
- Deep linking: an instructor's request opens `/lti/pick/<id>` (theirs only, 30 minutes, used once) listing the organization's published assignments; the choice goes back to the LMS as a JWT signed with Gretlab's key (`lti_keys`, made on first use, or `LTI_PRIVATE_KEY` and `LTI_KEY_ID`), as a resource link with a gradebook column out of the assignment's total.
- Grades: the gradebook's **Send grades to LMS** (whoever sets the assignment and sees its grades) gets a token with a signed client assertion (client credentials, the score scope) and posts each student's total as an LTI score to every linked column; students who never came through that LMS are skipped and counted.

## GitHub projects

- An assignment (not an exam) may have projects (`assignment_projects`: title, markdown instructions, points), written in its form's Projects section; an assignment may be projects only. Edits keep project ids, so handed-in work stays; removing a project removes its work. Template uses keep their own projects.
- Students hand in a GitHub repository link on the assignment page (`project_submissions`). Links are parsed strictly (`packages/judge/src/github.ts`, unit-tested: github.com only, GitHub's name rules, an optional `/tree/<branch>` or `/commit/<sha>`, no `..`), so the server only ever calls `api.github.com` with checked parts. The submission is pinned to the commit: a commit link as given, otherwise the branch's current commit from GitHub's API (4 s timeout; `GITHUB_TOKEN` raises the rate limit). GitHub saying "not found" refuses it (private repos must be shared with the teacher, who then sees the branch); GitHub unreachable or `GITHUB_LOOKUP=off` (the e2e tests) saves it unpinned.
- Handing in is open from when it opens until the student's own due time (their extension counts), later only with late work allowed (then marked late). Handing in again replaces the work and clears its mark.
- Teachers mark from the gradebook's Projects column (mark up to the points, markdown feedback); marks count in totals, the CSV and early warnings (a handed-in project isn't missed work). Students see marks and feedback unless results are held, and are notified when marked.

## Peer review

- An assignment (not an exam) may have peer review (`assignments.peer_review`: reviews per student, anonymous, an optional review due time after the assignment's), set in its form. Students review classmates' final code; it never changes marks.
- After the due time a teacher presses **Start peer review** in the gradebook (once; `startPeerReview`): per problem, everyone with a graded submission from when it opened reviews `reviews` others, in a seeded shuffled ring (`packages/judge/src/peer.ts`, unit-tested): never themselves, everyone gives and gets the same number. Reviews point at the submission as it was then (`peer_reviews`). Reviewers are notified.
- A review scores each of the problem's rubric criteria (or one Overall out of 5), comments on lines of the code (checked to exist) and sums up; drafts may be partial, handing in needs every score and a summary. Changeable until the review due time (`reviews_closed` after).
- Authors see handed-in reviews of their work (notified on the first); anonymous means reviewers are "Classmate N" and "Reviewer N" both ways. Teachers see every review with names and scores, read summaries, and hide one from its author.

## Class discussions

- Each class has a Discussion tab (`features/discussions`, `discussion_posts` threads and replies, `discussion_votes`): everyone sitting in the class or teaching it reads and posts; other classes and outsiders get 404. Markdown with code blocks; 30 posts an hour each.
- Students may post anonymously: classmates see "Anonymous", teachers and the author see the name. Teachers always post as themselves, marked Teacher (anyone with a teaching permission covering the class, owners and admins included: `runsClass`).
- Teachers pin, lock (no more student replies), hide (only teachers and the author see it) and mark one reply as the answer (shown first); authors edit and delete their own. A thread with replies is kept as "Deleted post" so they make sense. Hiding and deleting others' posts go in the activity log.
- A reply notifies the thread's author (`discussion_reply`), linking to `?tab=discussion&thread=<id>`, which opens the thread. +1 votes, not on your own posts.

## Early warnings

- A class's Grades tab starts with **Needs attention** for teachers who see its grades (`features/classes/warnings.ts`): each student flagged and why. Rules (`packages/judge/src/warnings.ts`, unit-tested, defaults in `WARNING_RULES`): missed work (a finished assignment set for them with nothing submitted and no quiz answer), under 40% on finished work once two have finished (weighted by points), nothing submitted for 7 days while they have unfinished open work, attendance under 75% once four classes are marked. One reason is "watch"; two or more, or two missed, "at risk". Due times count each student's extension. Computed on each request, never stored.
- Teachers tick students and **Send a note**: a `teacher_note` notification (and email) to each of them, from the teacher; only the class's students. The activity log records that a note was sent, not its words.

## Certificates

- Given in a class by whoever may set its work (`features/certificates`, `certificates`), from the Course tab's Certificates panel: for finishing one of the class's courses (every item done; once per student per course, even if revoked) or one the teacher writes for chosen students of the class. Students are notified and find them under My certificates (account menu, `/certificates`).
- Each has a short public code (`ABCDE-23456`, no 0/O/1/I/L) and a page at `/certificates/<code>` that anyone can open without signing in: name (never email), title, college, issuer, date, and whether it's valid or revoked. It prints as the certificate. Revoking keeps the record and says so on the page; issuing and revoking are in the activity log.

## Cohort runs and mentors

- Kinds say whether their groups run between dates (`groupDates`: cohort, coaching) and whether each group has its own lead (`leadPerGroup`: everything but schools and colleges, which name class teachers per academic year). `org_groups.starts_on`/`ends_on`/`lead_id`, set with `PUT /orgs/<slug>/groups/<id>/run` (`setGroupRun`, needs "Edit groups"), from the Groups page's "Dates & mentor". Kinds without them get 400 `not_for_kind`. A new lead who doesn't teach the group yet is given the kind's instructor role (Mentor) on it; the role stays if they stop leading.
- Where a run is (`packages/judge/src/runs.ts`, unit-tested): upcoming with days to go, week N of M while running, or finished. Display helpers in `features/runs/format.ts`.
- **Progress** (Manage › Academics, only for kinds with runs; `features/runs`): each run with its week and its pods' mentors, and a run's page with every learner's work handed in of work due, attendance, last activity and early warning (`learnerSignals` in `features/classes/warnings.ts`, which the class's Needs attention also reads), by pod. Program managers see whole runs; a mentor sees only the pods they can see grades for.
- **Graduation** from a run's page issues `graduation` certificates (`issueCertificates`, needs "Manage assignments" on the run): once per learner per run, only for people in it, only for groups with dates.
- Homes: a learner sees their cohort, its week, their pod and its mentor; a mentor sees the pods they lead, linked to their progress (`homeRuns`, `runs` in the home data; null for kinds without runs).

## Assigned training (companies)

- The `training` module (on from the start for companies; optional for cohorts, coaching and other kinds; `features/training`): a course assigned to a department or team with a due date and, for compliance, renewal every N months (`course_classes.due_on`, `renew_months`). People take it on their team's page like any course, where the due date shows. Manage › Training lists each training with how many are done, late or due soon; a training's page lists each person with their team, progress, status, needed-by date, when they finished and until when it's valid, with Remind (a `training_due` notification), Certify finished (course certificates) and Change/Remove for those who may manage it.
- Statuses (`packages/judge/src/training.ts`, unit-tested): todo, due (within 7 days), overdue, done, expiring (within 30 days), expired. With renewal, work older than the renewal period stops counting (`renewalCutoffs` in `features/courses/classes.ts`), so the course asks again and the person redoes it; it's valid until their oldest item's last completion plus the renewal.
- Course certificates for renewed training get `certificates.expires_on`; the public page and My certificates say "Valid until" or "Expired", and a new one can be issued once the last has expired.
- Who sees what: L&D admins everything; a manager (a team's lead, given the Manager role on it) the part of each training within the teams they see grades for; employees their own on their home (My training) and in the bell's reminders when overdue, due within a week, expired or expiring. A manager's home has Team training: done, late and due soon.

## Communities: open groups and events

- Kinds say whether members join groups themselves (`openGroups`: community, other). A group is opened from the Groups page ("Moderator & joining", `org_groups.open`, via `PUT .../groups/<id>/run`); members see open groups at `/orgs/<slug>/groups` (sidebar "Groups", or "Join groups" next to the staff page) and join or leave them (`openGroups`, `joinOpenGroup` in `features/orgs/server.ts`, logged). Closed groups only through staff. In these kinds an active member with no role has a home before joining anything, pointing them to the groups.
- The `events` module (on from the start for communities, optional for every other kind; `features/events`, `org_events`, `event_rsvps`): events for everyone or one group (and the groups inside it), with a place and/or online link, optional capacity. "Run events" (`events.manage`, part of the instructor role, so a group's moderator runs its events). Members see events for everyone and for groups they're in, and say they're going: a place, or the waitlist once full (`packages/judge/src/events.ts`). Places are given under a row lock on the event, so the last one goes to one person. Dropping out or a larger capacity moves the longest waiting up (`event_place` notification). The online link shows only to people going and those running it. Changing the time or place and cancelling tell everyone going or waiting (`event_update`); cancelled events stay listed, marked.
- Events people are going to or waiting for are on their calendar and iCal feed; the bell reminds them within a day of the start; homes list the next few.

## Email templates

- Every email the site sends is built by `composeEmail(key, values)` (`features/emails/server.ts`) from a template in `packages/judge/src/emails.ts`: account confirmation, account already exists, password reset, security notice, sign-in code, notification (every notification emailed), weekly summary. Each is branded HTML (table layout, inline styles, the site's name in the header, a shared footer) with a plain-text copy; the outbox stores both (`email_outbox.html`) and Resend and SMTP send both.
- Dashboard › Emails (`platform.emails.manage`, "Manage email templates", under site settings): edit any email's subject and body and the shared footer, with clickable placeholders, a live preview (HTML and plain text, rendered by the same code that sends), "Send me a test" with example values, and reset to default. Stored when changed (`email_templates`, key `layout` for the footer), read through a 30-second cache cleared on save; every change logged (`platform.email_template`).
- Wording markup: `{{placeholder}}`, `**bold**`, `[words](url)`, `[button: words](url)` on its own line, `- ` list lines, blank lines for paragraphs. Placeholders are filled after the markup is read, so what people wrote is never markup, and it's always escaped; links must be http(s) or mailto. Saving refuses unknown placeholders and wording missing a required one (the link or code an email exists to deliver).
- Tests that change templates put them back through the API, so the server's cache is cleared.

## Roles by kind

- Beside the four built-in roles (owner, admin, the kind's instructor, member), each kind has **suggested roles** (`packages/judge/src/role-templates.ts`): a school's Principal, Vice principal, Class teacher, Subject teacher, Exam coordinator, Admissions officer, Office staff, Librarian, Transport manager, Hostel warden, Counselor; a college's Dean, Head of department, Faculty advisor, Lab assistant, Exam cell, Admissions office, Librarian, Hostel warden; coaching, cohort, company, community and other have their own. Each has a scope hint (organization-wide, or within a group like a department). None includes settings or roles.
- A new organization starts with its kind's suggested roles (`org_roles.template_key`); they're ordinary roles to rename, change or delete. Manage › Roles offers those it doesn't have ("Suggested for a school", `GET/POST /orgs/<slug>/roles/suggested`), only if the person may hand out every permission in it and no role has its name.
- Platform staff with "Manage organization kinds" set each kind's list (Dashboard › Organization kinds › Suggested roles: add, edit, remove, back to default), stored in `org_kind_policies.role_templates` (null: the default), cached 30 seconds and cleared on save, logged (`platform.kind_roles`). Refused: two roles of one name or key, a built-in role's name, unknown permissions. Existing organizations' roles never change with it.
- Built-in platform roles: Owner, Content admin, Reviewer, Support, Organizations manager, Communications (emails and notifications), Content editor (write library content, not publish or delete), Auditor (read-only).

## Demo data

- `pnpm --filter @workspace/db demo` (`packages/db/src/demo.ts`) shows which database it would wipe and changes nothing; `--wipe=<database name>` (typed exactly) empties every table except configuration (settings, language settings, runners, LTI keys, kind decisions, email wording), re-imports the problem library, and makes one organization of each kind with a few months of realistic activity (`src/demo/*.ts`, seeded randomness: the same data each run, dates relative to today). Re-running replaces it all.
- **What else it makes:**
  - The school has a Grade 10 contest from ten days ago, with results.
  - The platform has an open contest next week.
  - The school has an upcoming Unit test 2 with a paper a day.
  - The school, college and coaching centre have holidays: a break that just ended, one coming up, and the national days (`demo/holidays.ts`).
- Every demo account signs in with email and the password "Gretlab demo 2026"; addresses are on `<org>.demo.invalid`, so no email is ever sent to them (`isUndeliverable` in `packages/judge/src/records.ts`; `isNoLoginEmail` is only the no-login students' domain). The script prints the accounts to try, one per role. Platform admins still come from ADMIN_EMAILS.

## Platform staff inside organizations

- Two platform permissions reach into every organization, joined or not (`orgReach` in `features/platform/access.ts`, read by `context()` in `features/orgs/server.ts` and `viewpoint()` in `features/orgs/access.ts`): **Act in organizations** (`platform.orgs.act`: `ctx.platformAdmin`, everything an organization's admin can do, logged with `support` set) and **See inside organizations** (`platform.orgs.view`: `ctx.platformViewer`, an organization-wide read-only grant of `ORG_VIEW_PERMISSIONS`). Owners have both; Organizations manager and Support act; Auditor looks; custom platform roles may carry either.
- Both see suspended organizations. Personal things stay personal: your own leave, check-in, library loans and class seat need a membership.
- Leave: anyone who may see others' leave (staff, and both kinds of platform staff) gets the requests; deciding needs a permission that decides; people who only look get an "All requests" tab, read-only. The Leave pages answer only members, linked parents and platform staff who reach in.

## Calendar

- `/calendar` (account menu) lists everything with a date for the viewer, by day (`features/calendar/server.ts`, `eventsFor`):
  - published assignments' due times with their own extension, exam windows, and peer reviews still to write that have a due time;
  - contests they registered for or their organizations run (the platform's open contests don't fill everyone's calendar).
- From each organization they're in, `orgDates()` adds:
  - its holidays;
  - exam papers with a date in the classes they or their children sit (named for the child);
  - their own or their children's leave, approved or waiting;
  - training they still need to do, on its need-by date;
  - the dates of cohort runs they're in.
- These are whole days (`allDay`): the page shows "All day" or the last day, keyed by the date itself so it never shifts with the viewer's time zone.
- The same events as a private iCal feed at `/api/v1/calendar/<secret>.ics` (`users.calendar_token`, 24 random bytes): calendar apps can't sign in, so the address is the key. Off until turned on; "New link" retires the old one; blocked accounts' feeds stop. It never includes marks or code. iCal rules (escaping, 75-octet folding, UTC, CRLF, stable UIDs): `packages/judge/src/ical.ts`, unit-tested. Absolute links use `NEXTAUTH_URL`.

## Integrations: API keys and webhooks

- **Where.** Manage › Integrations (`features/integrations`), for whoever holds `org.settings.manage` across the organization. The guide for whoever builds the other side is `docs/api.md`.
- **API keys** (`org_api_keys`, migration 0070):
  - The format is `glk_<10-char prefix>_<secret>`. Only its SHA-256 is stored; it's shown once.
  - `route()` sees `Authorization: Bearer glk_…`, finds the key (`userForApiKey` in `keys.ts`), and refuses any path outside `/api/v1/orgs/<its slug>`. It then runs the handler as the key's maker, with the key in the request context and no cookies or CSRF check. Routes with platform access refuse keys.
  - The org context narrows the maker's grants to the key's permissions and drops platform reach (`context()` in `features/orgs/server.ts`).
  - A key can only carry permissions its maker holds across the organization. A key can't manage keys or webhooks.
  - Audit entries name the key in their actor label.
- **Webhooks** (`org_webhooks`, `webhook_deliveries`):
  - Every audit entry with an organization queues a delivery for each active webhook whose patterns match its action (`*`, `area.*` or exact; `eventMatches` in `packages/judge/src/integrations.ts`, server-only entry `@workspace/judge/integrations`). It's queued in the same transaction.
  - Deliveries are sent after the response (`after()` in `route()`), and the cron route retries the rest. Each is leased with `FOR UPDATE SKIP LOCKED` so two senders don't double up.
  - Requests are signed (`Gretlab-Signature: t=…,v1=HMAC-SHA256("t.body")`). Backoff runs from 1 minute to 24 hours; after 8 attempts a delivery is "failed". Redirects aren't followed.
  - Addresses must be public https (`webhookUrlProblem`). `WEBHOOKS_ALLOW_LOCAL=true` allows local addresses for tests.

## Holidays

- **The table.** `org_holidays` (migration 0069) holds the days an organization is closed: a name and a first and last day, at most three months.
- **Who edits.** Manage › Holidays (`features/holidays`), for whoever holds `org.settings.manage` across the organization. Adding and removing are audited.
- **Who sees them.** Everyone in the organization can read the list; they're on everyone's calendar.
- **Homes.** On a holiday the admin and teacher homes ask for no registers ("not taken" is empty), and the greeting names it (`holidayOn()`).

## Notifications

- Every notification belongs to an event in the catalog (`packages/judge/src/notifications.ts`, unit-tested): eight for students and anyone (new assignment or exam, marks and feedback, more time, class notice, a teacher's note, certificate, peer review, discussion reply) and three for staff (a colleague published work, a request to join, the weekly summary). A stored notification's `kind` maps to its event (`eventOfKind`). To add one: add it to the catalog with its kinds, call `notify()` with that kind and the `orgId` it happened in; the dashboards and people's settings pick it up.
- Three levels decide, each only narrowing the one above: the platform (Dashboard › Notifications, "Platform settings"; a `settings` row `notifications.policy`), the organization (Manage › Notifications, the "Manage notifications" permission — a child of "Organization settings", so settings-managers keep it and a role may have only it; `organizations.notifications`), then the person (`/notifications`, linked from the bell; `users.email_notifications` for all email and `users.notification_prefs` per event). Per event a level has three switches: `inApp`, `email`, and `userChoice` (people may turn its email off or on; without it the email goes to everyone it concerns, even someone who turned all email off). A switch is on only if every level has it on (`effectivePolicy`), so what the platform turns off an organization can't use, and its page shows it locked. Levels store only what they turned off, so a new event is on everywhere. The platform's own work (`orgId` null) follows the platform's switches only. Changes are audited (`notifications.update`).
- `notify()` (`features/notifications/server.ts`) looks up the event's policy, stores the bell notification if `inApp`, and queues email for the people `deliveryFor` gives one, in one transaction; it never fails the action that caused it and returns how many were told each way. `policy.ts` (read-only, imports no other feature, so anything can call `notify()`) and `policy-admin.ts` (the dashboards' views and saves) split the server side.
- Who is told: students of the audience for class-wide events; the one person concerned for the rest. Staff: when work is first published, the class's other teachers get a copy (`colleaguesOf` in `features/assignments/server.ts`: roles with "Set assignments" or "See grades" for a group the audience touches or for the whole organization; not the publisher, not owners and admins; in the bell by default, by email only for those who ask). People with organization-wide "Invite and approve" hear of a request to join. `emailByDefault` in the catalog says whether people who haven't chosen get an event's email.
- The weekly summary (`features/notifications/digest.ts`) is an email on Monday 08:00 in the site's timezone to people with organization-wide "Change settings" (owners and admins): requests waiting, new members, work published, solutions submitted, notices, certificates, what's due. `/api/cron/outbox` queues the ones due before it sends; each organization is claimed once per week by writing the week's key (`organizations.digest_week`, from `weeklyDigestKey`), so schedulers running at once send one. A week with nothing to say sends nothing.
- Reminders that depend on the clock are worked out when read, never stored: work due within a day and not finished, a contest starting within a day, attendance below 75% in a class with four or more marked classes. No scheduler needed.
- Email goes through an outbox, never straight from a request. `notify()` writes the notifications and the emails (`email_outbox`) in one transaction, then `after()` runs `drainOutbox()` right after the response. A drain claims a provider-sized batch with `FOR UPDATE SKIP LOCKED`, sends it, and records each result; it stops before a 25-second budget so a serverless function is never killed mid-batch. Retries and big batches are finished by `POST /api/cron/outbox` (`CRON_SECRET`; 503 `not_configured` without one, 401 on a wrong token), called by any scheduler: `apps/web/vercel.json` (daily on Hobby), `.github/workflows/email-outbox.yml` (every 15 minutes), the `scheduler` service in `docker-compose.prod.yml`. Rules (unit-tested, `packages/judge/src/outbox.ts`): backoff 1 min, 5 min, 30 min, 2 h, 6 h, then failed; temporary are 429, 408, 5xx, no answer, and a missing or wrong key (401/403: the operator's to fix, so queued mail still goes); other 4xx and SMTP 5xx are permanent. A send cut off mid-way is reclaimed after 10 minutes. Sent rows are deleted after 7 days, failed after 30.
- Providers live in `features/notifications/mailer/`, one file each behind the `Mailer` interface (`send(from, mails)` returns a result per email and never throws): Resend's API (`RESEND_API_KEY`; batches of 100, an `Idempotency-Key` from the outbox ids, and if a batch is refused as invalid, one by one so one bad address fails alone) and SMTP (`SMTP_URL`, pooled nodemailer, for self-hosting). Add a provider by implementing `Mailer` and choosing it in `mailer/index.ts`. Delivery is at least once.
- The header's bell shows unread plus reminders and links to the person's settings; it's replaced by the exam header during a sitting.
- Anyone whose role can set assignments counts as staff of a class, not a student (`studentsOf`), so a class of only teachers notifies nobody.

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

- **Page addresses.** Links to an organization's pages come from `orgPages(slug)` in `apps/web/lib/paths.ts`, never hand-built strings:
  - pages: `.home`, `.leave`, `.event(id)`, `.cls(groupId, tab)`, `.child(id)`, `.results(id)`;
  - management pages: `.manage("/exams")`.
  - A page that moves changes there.
  - API addresses stay with the `api()` calls that use them.
- **Response types.** A screen takes its data's type from the server function behind the route, not a copy: `type Report = ApiResult<typeof orgReport>`, with `import type` only (`apps/web/lib/api/types.ts`; `Jsonified` turns dates into strings, as JSON does). Every screen that calls an API uses this: about 180 response types.
  - The exceptions, where the screen deliberately shapes data differently, keep a local type with a comment: the problem editor and practice page, admissions, the question session, the organization's public page, and the staff check-in.
  - Server functions should return precise types (literal unions, not `string`; `row!` after an insert's `returning()`), since screens now see them as they are.
- **Errors.** Unexpected server errors go through `reportError()` (`apps/web/lib/report-error.ts`): one JSON log line with a short `ref`. API 500s show that ref to the person, and `instrumentation.ts` reports page and server-action errors the same way.
- **File size.** Screens and server modules are split by job, with the old file kept as an index that re-exports, so imports don't change. Examples: `features/home/components/home-*.tsx`, `features/results/components/*`, `features/orgs/{core,groups,server}.ts`, and `features/assignments/{grading,student-work,staff-work,gradebook-server}.ts`. When a file passes about 800 lines, split it the same way: shared types and helpers in a `*-parts` or `*-core` file, one file per screen or job, no circular imports.
- **CI.** `.github/workflows/ci.yml` runs lint, typecheck, unit tests and `drizzle-kit check` on every push. The end-to-end regression stays local (`pnpm test:e2e`, Docker with gVisor).

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
- Next route files (`route.ts`, `page.tsx`) may export only what Next allows (handlers, `metadata`, the page). Put shared schemas in `features/*/schemas.ts`.
- A `route()` handler that returns `null` or `undefined` answers `{ ok: true }`; return an object (`{ exam: null }`) when the client reads a value.
- `route()` refuses cross-site POSTs (its origin check). Endpoints that another site posts to (an LMS's LTI launch) are plain handlers with their own errors: `features/lti/http.ts`.
- Times compared with submission stamps use the database clock (`dbNow()`): the Docker VM's clock drifted from the host's and broke exam timing once.
- Migrations: never edit one that's applied anywhere; add a new one. Data migrations are SQL appended to the generated file (0030 sharing defaults, 0031 the platform course from units), kept idempotent, and mirrored in the seed when a fresh database needs the same rows.
- Sharing changes (`setSharing`) keep `updated_at`, so an open editor doesn't get a false conflict.
- In `next dev`, Turbopack has served stale module exports after a file gained new exports (a function "is not a function"). If a dev request fails that way, check on a production build (`pnpm --filter web build`, then `next start -p 3101`) before chasing a bug; restarting `pnpm dev` clears it.

## Testing

- `pnpm test`: unit tests of the pure rules in `packages/judge` (grading, quizzes, exams, outcomes, platform roles, course release, warnings, peer pairing, iCal, GitHub links, LTI launches, starter code, the judge).
- `pnpm test:e2e` (`e2e/run.sh`): everything against a throwaway database (`gretlab_test`, recreated each run) and real gVisor in a Docker rig: queue guarantees, 16 hostile programs, API security, every seeded solution, then every suite below against a production build on :3100 (started with `PROXY_SECRET`, `GITHUB_LOOKUP=off`, `LTI_ALLOW_HTTP=true`, and `RESEND_API_KEY`, `RESEND_API_URL` and `CRON_SECRET` pointing email at the fake provider `e2e/notifications.mjs` runs; while it isn't running, other suites' emails just wait in the outbox). About 40 minutes; set `E2E_SCREENSHOTS` to keep screenshots. Run it before merging anything touching the sandbox, queue, auth or the API, and as an ordinary process (a backgrounded, low-priority run timed out browsers and looked like failures). It needs roughly 10 GB free disk: when Docker runs out of space builds fail with `ENOSPC` and Docker itself can get I/O errors (`docker builder prune` frees build cache; never prune volumes, which hold the data).
- One suite against your dev server and database: `E2E_DB=gretlab NEXTAUTH_SECRET=<your dev secret> node e2e/<suite>.mjs http://localhost:3000 /tmp/gretlab-e2e/<dir>/`. Suites make their own users and organizations with a prefix (`lib-`, `crs-`, `tpl-`…) and delete them at the end, so they don't touch real data.
- `e2e/stack.sh` with `e2e/load.mjs` and `e2e/resilience.mjs`: load and failure tests on the production shape. See `docs/scaling.md`.
- `e2e/features.mjs`: library, daily (problem and question), streaks, notes, lists, study plans, profiles, leaderboard, hints, editorials, integrity, editor extras and their switches.
- `e2e/orgs.mjs`: joining, invites, groups, scoped roles, no-escalation, owners, the activity log, several organizations; organization content aimed at groups (contests, assignments, problems, notices, gradebooks, import); teaching logs, teacher home and reports; outcomes (POs, COs, tagging, attainment); and the pages.
- `e2e/assignments.mjs`: grading rules, late penalties, gradebook and CSV, privacy, drafts and playback, rubrics, line comments and releasing feedback, lab exams (sittings, networks, events, more time, the site-wide lock, start window, edits after starting), problem import and assessment-only problems, the switch and the pages.
- `e2e/library.mjs`: sharing the platform's content (every college, chosen colleges or teachers, staff only), what each college sees and can pick, copying, collections and the pages.
- `e2e/certificates.mjs`: course and written certificates (once each, class only), the public page (no sign-in, no email, any case, unknown codes), revoking, My certificates and the class panel.
- `e2e/calendar.mjs`: what's on someone's calendar (extensions, exams, contests, reviews; not drafts or other classes), the iCal feed (no sign-in, new link, off, blocked accounts) and the page.
- `e2e/lti.mjs`: LTI 1.3 against a fake LMS it runs (own keys, token and score endpoints): registration, login and launch, every refusal (forged, nonce, audience, deployment, expired, version, reused state, no email), accounts, classes and roles, opening assignments, sending grades (assertion and score checked like an LMS), deep linking (Gretlab's signature checked), and the pages.
- `e2e/notifications.mjs`: who hears about what, against a fake email provider it runs (port 3198): who may manage each level, the platform's switches locking an organization's, an organization's (bell off, email off, no choice), a person's (one event, all email), the copy to a class's other teachers, a request to join, the weekly summary (once a week, off per organization), the audit, and the three pages (a phone width for the person's).
- `e2e/permissions.mjs`: fine-grained roles end to end — a custom role with only `assignments.grade` grades but can't create, publish or delete; `assignments.create` drafts but can't publish; the coarse `assignments.manage` still does all; a parent-holder may hand out a child while a child-holder can't grant a sibling; members' change-groups, remove and assign-roles are separate (remove is org-wide).
- `e2e/org-types.mjs`: kinds of organization (school, cohort, company: their default group levels; an unknown kind refused), modules (not switchable before ready or for a kind that can't use them; choices remembered; unknown refused), the sidebar naming groups per kind, and the Modules card shown only where it applies.
- `e2e/attendance.mjs`: the module on for a school, off for a company and when switched off (404, gone from the sidebar); a teacher sees only their section; students and other sections' teachers refused; future days, non-students, bad statuses and bad queries refused; taking, correcting (one row), a second period, the audit, registers kept out of the teaching log; the month (late counts, excused left out); the pages, and a phone width.
- `e2e/subjects.mjs`: the module on for a school, off for a company; adding, duplicates (name any case, code), bad codes, renaming; putting a subject on a class with a teacher who teaches there (a student or another section's teacher refused), changing the teacher (one row); an assign-only role limited to its section; deleting; the audit; the page and its dialogs, and a phone width.
- `e2e/timetable.mjs`: on for a school, off for a company; periods and days (bad times refused, only `timetable.periods` may change them); filling cells; a teacher's clash across sections (409); breaks, days off and another class's subject refused; an editor scoped to one section; a student sees their class's week and not another's (404); a teacher's own week; turning a period into a break, or removing it, clears its cells; the audit; the page, dialog, grid, class tab and My timetable, and a phone width.
- `e2e/parents.mjs`: on for a school, off for a company; linking a new parent by email, relinking (one row), bad input, self-links; a section-scoped "Parent desk" role and its student search; linking from a list with a report; who sees and removes which links; a parent sees only their child (404 otherwise), isn't a member, gets the linked note, notice copies and one absence note per change; parent events shown only to parents; the child page's attendance, absences, timetable and notices; switching off; unlinking; the audit; both pages and their dialogs, and phone widths.
- `e2e/books.mjs`: off until switched on, refused for a company; the catalog (add, a list with a report, members search it, outsiders don't), copies can't drop below loans, a book on loan can't be deleted; lending (has it, none free, the per-person limit, the loan period, a past due date, members only), renew, return, a closed loan, lost (a copy fewer); separate catalog and desk roles; overdue on the desk, in the numbers, in the bell, on the member page, on My classes and on the parent's child page; the audit; the desk, catalog and member pages and dialogs, and phone widths; switching off.
- `e2e/transport.mjs`: off until switched on, refused for a company; routes (backward pick-ups, a stop listed twice, bad times, duplicate names, no seat limit), the office can't assign and bus duty can't add routes; riders (scoped to a section, a stop from another route, a full bus, moving a stop), the rider and their parent told; riders listed per route; My classes and the parent's child page; fewer seats than riders, removing a used stop, growing a route with riders kept; a list with a report; taking off; removing a route; the audit; the page, the route and riders dialogs, My classes, and a phone width.
- `e2e/hostel.mjs`:
- `e2e/audit.mjs`:
  - What an entry holds: settings changes field by field, modules and permissions added by label, the area, the address (only through the trusted proxy) and browser, support stepping in, and who acted, kept after their account is deleted.
  - Filters and paging: by area, person, words and dates; pages without repeats; nonsense filters give a 400.
  - CSV and access: filters apply, changes are written in words, formula-looking names are made safe, the download is logged, and only those allowed can read the log. The platform's log reads the same way.
  - The page: its filters, the details dialog, and a phone width.
  - Setup: off until switched on, and refused for a company. Hostels (duplicate names refused). Runs of rooms, with existing names skipped and backward runs refused. Lettered beds.
  - Allotting: scoped to a section; a taken bed is refused; moving frees the old bed. The resident and their parent are told. My classes and the parent's child page show the bed.
  - Changing rooms: fewer beds never removes an occupied one, more beds add letters, duplicate room names are refused, and occupied rooms and hostels can't be removed.
  - A list with first-free and named beds and a report. Who sees whose names. Moving out. The numbers. The audit.
  - Pages: the page and its hostel, rooms and bed dialogs, My classes, and a phone width.
- `e2e/two-factor.mjs`:
  - Setup: the QR code and key, sealed at rest, a wrong code, confirming through the session update.
  - Older sessions owe the second step (signed out everywhere). Codes can't be reused; one step of drift is allowed. Backup codes work once. Five wrong codes lock the step.
  - New backup codes, and turning off with a code.
  - Required for staff or everyone: blocked until turned on, can't be turned off, and an admin can't require it before using it.
  - Platform reset, the users list, the security log.
  - Pages: the Security page, finishing sign-in from a public page and from a redirect, and a phone width.
- `e2e/home.mjs`:
  - Who gets which view: admin, teacher, student or parent.
  - The school view's numbers against a seeded school (students, teachers without owners, classes, present today and open registers, recent days, checklist, needs attention, coverage).
  - The teacher's day from the timetable, their own classes, registers to take and low attendance.
  - The sidebar's groups by permission, manage pages in the same frame, and the phone menu.
  - Every width (1920, 1440, 834, 390) without sideways scrolling.
- `e2e/records.mjs`:
  - The module, and academic years: bad dates, duplicates, one current. Making another year current empties classes, and switching back restores them; only an empty year can be deleted.
  - Adding students with and without a sign-in, suggested and unique admission numbers, sections only.
  - Who may do what: an office role scoped to a grade, teachers limited to their class, students with no access.
  - Personal details sealed at rest; search and filters; moving, withdrawing, restoring.
  - No mail to `.invalid` addresses; a parent for a no-login student; the home checklist; the log.
  - The pages and the add sheet, at laptop and phone width.
- `e2e/promotion.mjs`: import (bad rows refused, nothing half-written, scoped to the importer's grade), creating records for existing members, the promotion plan's suggestions, a preview, applying with exceptions, running twice, making the new year current, who may promote, and the wizard at laptop and phone width.
- `e2e/college.mjs` (also course attendance: registers by course, the 75% rule, the report tab, the student's card): courses with credits (halves only; schools don't ask); semesters (once per year, an exam's must be the year's, removing one keeps its exams); mid- and end-semester weights into each course's grade on the UGC scale; SGPA per semester (9.47, 8.82), a failed course as a backlog, the CGPA by credits; the grade card on the page, in the PDF and on a phone; schools keep percentages; the college's words.
- `e2e/org-kinds.mjs`: each kind's levels and role names; the kind locked (platform admins too); modules limited by kind; the platform's per-kind policy applied to existing organizations at once, by staff allowed to, audited; the kind's words in the frame and homes; the create form's picker, warning and confirmation; the admin's kinds page; Settings showing the kind read-only. It puts the policies back through the API (clearing the server's cache) before its clean-up.
- `e2e/links.mjs`: every link works for the person it's shown to. As the platform admin, a school owner, a teacher, office staff, a student and a parent it opens their home and follows the links on each page (one page of each kind, ids collapsed, up to `LINKS_LIMIT` pages), failing on any error status, sign-in bounce, or a "not found" / "not part of your role" page. Download links under `/api/` must answer 200. `LINKS_DUMP=file` writes the pages reached, to compare against all pages for ones nothing links to.
- `e2e/member-home.mjs`: where `/` leads (visitors, signed in), what the home gathers (schools and requests waiting, a parent's child, practice, work and contests), features switched off, no home for visitors; the page at laptop and phone width with Home in the header.
- `e2e/pdfs.mjs`: report cards for the student, parent and staff (nobody else); a class's report cards; names outside the fonts; transfer certificates (who may issue and print, dates, numbering, marking transferred, sealed as issued, the log); ID cards; the buttons. Each PDF is opened with pdf-lib to check it's valid, with the right page count and title.
- `e2e/admissions.mjs`:
  - Closed by default; opening (who may, a year, grades only); applying (checks, duplicates, five at most, numbers per year, sealed details); the office told, the list, filters, search, the sidebar and home counts.
  - Reviewing, waitlisting, turning down with a message; admitting into the current year (record, enrolment, place, parent linked, parent's home) and into next year (enrolled, not placed); a student applying for themselves; withdrawing; closing; the log.
  - The pages: applying from the public page on a phone, admitting from the office, the record link for those who may see records.
- `e2e/signup.mjs`: off by default; reviewed (inactive, admins told, pages waiting, approving opens it and tells the owner); open; the set-up (year, grades with sections); taken addresses, bad years and grades, three a day; the pages (the link, the form on a phone, approving in admin).
- `e2e/staff-attendance.mjs`:
  - Who counts as staff; marking a day (times, notes, corrections, no future days, staff only); who may mark or see.
  - Self check-in (late after the late time, once a day, switched off); approved leave on the register and in the month; the month report; your own attendance; the staff home; the log.
  - The pages: saving the day, the month, a phone, My attendance, the sidebar.
- `e2e/leave.mjs`:
  - Who can ask (parent, student, staff); the class teacher decides their class, the school-wide approvers when there's none, the office staff; nobody decides their own.
  - School days, weekends, half days, overlaps, balances and unpaid leave; refusing with a reason; taking back.
  - Leave after the fact excuses an absence; registers mark who's on leave; no absence alert for leave asked for; kinds of staff leave; the log.
  - The pages: asking on a phone, approving from the page, the sidebar count, the register's "On leave" tag.
- `e2e/exams.mjs`:
  - The scale; exams (duplicates, dates, who may); papers per subject per section (including the grade's subjects; adding twice adds nothing).
  - Marks by the subject teacher, an exam-cell role and nobody else; halves, limits, absences, students of another class; corrections logged separately.
  - Results and ranks; publishing (asks with marks missing, tells students and parents, locks marks); report cards for the student, their parent and staff (drafts hidden from the family); unpublishing; the log.
  - Class teachers (only those teaching the section), overall remarks (class teacher, coordinator, nobody else), subject remarks with marks, the comment bank, locked when published, on the report card.
  - The pages: adding an exam and papers, the results tab, entering marks with the keyboard, picking a remark from the bank, the class teachers dialog, the report card on a phone and from the parent's child page.
- `e2e/projects.mjs`: projects in assignments, repository links (spellings, refusals, pinning), the time rules and extensions, marking, totals and held results, edits keeping work, and the pages.
- `e2e/peer.mjs`: peer review settings, handing out, anonymity, writing and handing in reviews, authors reading them, teachers' overview and hiding, closing, and the pages.
- `e2e/discussions.mjs`: who can read and post, anonymity, replies and their notification, votes, moderation (pin, lock, hide, answer, delete), and the pages.
- `e2e/warnings.mjs`: who needs attention and why (missed, low marks, quiet, attendance), who may see it, notes to students, and the page.
- `e2e/templates.mjs`: writing templates, sharing them, using one for several classes with their own dates, edits reaching unopened uses only, stale saves, a college's own and copied templates, saving an assignment as a template, deleting, and the pages.
- `e2e/courses.mjs`: writing outlines (what a course may hold, stale saves), sharing courses, a college's own and copied courses, giving one to a class, release by day and by the module before, practice answers, teacher progress, deleting, and the pages.
- `e2e/platform.mjs`: platform roles, custom roles, the no-escalation rules, ADMIN_EMAILS owners, blocking, the activity log and the menu per role.
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
- [x] Quizzes: a question bank (single/multiple choice, short and written answers) with import, used in assignments, exams, contests and the daily challenge alone or with coding problems; teacher marks override; results after the due time or on release
- [x] Platform staff and roles: permissions, built-in and custom roles, no escalation, activity log
- [x] Certificates: for finishing a course or written by a teacher, each with a public verification page; revocable
- [x] Calendar: everything dated per person, with a private iCal feed for Google Calendar, Outlook and Apple Calendar
- [x] Notification settings at three levels (platform, organization, person), copies to co-teachers, join-request notices, a weekly summary for owners; email through an outbox with retries
- [x] LTI 1.3: connect an LMS, launches sign people in to their class, deep linking for teachers, grades sent back
- [x] GitHub projects: project work in assignments, handed in as repositories pinned to a commit, marked from the gradebook
- [x] Peer code review: students review classmates' final code against the rubric with line comments, anonymously if chosen; teachers start, read and hide reviews
- [x] Class discussions: threads and replies per class, anonymous to classmates, votes, teacher moderation and answers, reply notifications
- [x] Early warnings: students who need attention per class (missed work, low marks, gone quiet, attendance) with reasons, and notes to them
- [x] Templates: assignments and exams written once, shared from the platform or a college's own, used for many classes with their own dates; edits reach uses until they open
- [x] Courses: modules of library problems and questions with release rules, shared from the platform or a college's own, given to classes from a start day, practice and progress on the class's Course tab
- [x] One library with sharing: per-owner Library pages, collections, sharing platform content with all or chosen colleges and teachers, copying to adapt
- [x] Notifications: in-app bell with stored events and computed reminders, optional email
- [x] Extensions and resubmission: a later due time for one student, whole assignment or reopened problems; lets an absent student sit an exam later
- [x] Feedback: rubrics per assignment problem, line comments with saved comments, feedback held until released
- [x] Lab exams: timed single sittings, start window, lab network limits (IPv4/IPv6), site-wide lock during a sitting, tab/fullscreen/paste records, more time per student, forgetting addresses
- [x] Problems of an assignment, exam or contest: written or imported in their forms, kept out of the library; one import file format; assignment problems solved on the assignment's own pages
- [x] Outcomes: program outcomes per organization, course outcomes per class mapped to them, problems tagged with COs, CO and PO attainment with CSV
- [x] Classes: class pages (stream, classwork, people, grades, syllabus and log, insights), class notices, attendance, teacher class tree with today's work, student My classes, Learn/Teach modes, organization switcher
- [x] Scale: replicas, load balancer, connection pooling, queue priorities, load shedding, crash recovery, metrics, containers

Decided not to build for now: the AI tutor (it needs an Anthropic API key and a usage policy).

Shipped (November 2026): https://gretlab.grettech.com. The web app is on Vercel (Sydney, `syd1`), Postgres on Neon (the pooled address with `DATABASE_PREPARE=false` for Vercel, the direct address for the runner and migrations), and the runner on a dedicated AWS EC2 server with gVisor, set up and updated by `deploy/runner-setup.sh`. README › How the live site runs has the settings, the release steps (migrate first, then push, then update the judge if it changed) and how to watch it. Railway was tried and dropped: it can't run gVisor. Turborepo runs in strict env mode, so every setting the build needs must be listed in `turbo.json`.

The organization hierarchy we're heading for (from the owner's notes): platform › organization › year › branch › section (these three are an organization's group levels, set in its settings) › course › module › problems, questions, contests, assignments and exams. Groups and courses (with modules) exist; content is aimed at groups today.

Next, roughly in order of value for a college deployment:

0. Organizations, next: per-organization time and memory limits; class feedback reminders; members-only problems inside study plans; tagging assignments with syllabus topics; a server-paged members list for very large organizations.
0. From the LeetCode/HackerRank research, not built yet: discussion and solution posts with votes and moderation; contest ratings (Elo-style, newcomers rated separately) and contest history; virtual contests; contest code replay; test-case groups; company/position filters (n/a for a college); AI help (needs a policy decision first).

1. A separate, least-privilege database role for runners.
2. Student sign-in without Google: email and password, or college SSO (SAML/OIDC).
2. Two-factor authentication in the app, for everyone (the owner's decision, November 2026): passkeys or an authenticator app (TOTP) with recovery codes, independent of the sign-in provider. Required for platform staff and organization admins, then teachers, optional for students (an organization setting can require it). Step-up: critical actions ask for the second factor again if it's older than a few minutes (changing roles and permissions, grades and overrides, exam settings and extra time, LTI and organization settings, deleting content), recorded in the activity log. Google's "authentication strength" claims were considered and not used: they need a verified Google app, cover only Google sign-ins, and the app would still need its own check.
3. Plagiarism: cross-language detection and a side-by-side diff view (pairwise similarity within a language is built, under Plagiarism check).
4. Rate limiting on public endpoints at the edge; a Content-Security-Policy (Monaco and AdSense need care).
5. Monitoring and alerts for queue depth (the platform and organization activity logs are built; `GET /api/health/judge` reports a missing judge or a queue stuck over 3 minutes, for an uptime monitor; `/api/metrics` has the numbers).
6. Measure scale-out on real machines (see "What this does not prove" in `docs/scaling.md`); read replica for leaderboards if a contest ever needs it.
7. Server-side language servers for C++ and Java completion (only Python and JavaScript have real completion today).
8. Custom checkers for problems with more than one right answer; subtasks for IOI scoring.
9. Per-organization single sign-on and branding.

### Known limits

- Memory measurements come from inside the sandbox and are informational; time limits are enforced by `timeout` with a host-side backstop.
- Under gVisor a fork bomb can stop the whole sandbox rather than just failing `fork`. It is contained and reported as a failed run, and any remaining tests are not judged.
- Scale-out across machines is designed and tested for correctness, but its throughput has only been measured on one laptop.
- LTI 1.3 is tested end to end against a fake LMS in `e2e/lti.mjs`, not yet against a real Moodle or Canvas.
- Pinning GitHub projects to a commit depends on GitHub's API (60 lookups an hour without `GITHUB_TOKEN`); when it can't answer, work is saved unpinned.
- A calendar feed's address is its only key (calendar apps can't sign in); anyone with it sees that person's due dates.
