---
title: Where code runs
description: On the server for every language, or in the student's browser for Python and JavaScript, set by the platform, the organization and each assignment or contest, with provisional grading when the judge is down.
glance:
  who:
    - role: Platform owner
      note: sets the site's switches
    - role: Organization admin
      note: narrows them for its own work
    - role: Teacher
      note: chooses per assignment or contest
  where:
    path: /orgs/<slug>/manage/settings
    menu: "Settings › Code execution"
  permissions: [platform.settings.manage, org.settings.manage]
  module: coding
---

Code is normally run and graded in the server's sandbox, in every language. When that isn't
possible, or when you choose it, Python and JavaScript run in the student's own browser instead.

## Three levels

Each level can only narrow the one above it:

| Level | Where | What it sets |
| --- | --- | --- |
| The platform | Dashboard › Settings › Execution | **Server execution**, **Run in the browser**, and **Grade in the browser** (off by default) |
| An organization | Manage › Settings › Code execution | For its own assignments, contests and members-only problems: **Run code on the server** (off when the judge is failing) and **Allow grading in the browser** |
| An assignment or contest | Its form › Where code runs | **On the server** or **In the students' browsers**, and a **submission limit per minute** |

An organization can't turn on what the platform has off. An assignment or contest can choose the
browser only if its organization allows grading in the browser. Its form refuses that choice
otherwise, and says why.

## In the browser

- Only **Python** and **JavaScript** are offered: the editor hides the other languages. A problem
  that allows neither can't be solved in this mode.
- **Run** works as usual, on the cases in the panel.
- **Submit** works only where grading in the browser is allowed:
  1. the server sends every test's **input** to the browser, never an expected output;
  2. the browser runs them and sends the outputs back;
  3. the server compares them with the expected outputs and records the verdict.
- The result is marked **Provisional**. Once server execution is back for that work, the runners
  judge the same code again in the sandbox, and their verdict replaces the provisional one.

Without grading in the browser, Submit is paused until the server is back. Runs still work.

## When it falls back by itself

With the server off and no choice made:

- **Library practice** runs in the browser, and Submit is graded there if the platform has **Grade in
  the browser** on.
- **An organization's practice** does the same, if the organization allows grading in the browser.
- **Assignments** run in the browser, but Submit waits for the server. Choose **In the students'
  browsers** on the assignment to let students submit.
- **Contests** don't run code until the server is back, unless the contest chooses the browser.

## Submission limits

The platform sets how many submissions a student may make per minute (**Submissions per student
per minute**). An assignment or contest can set a lower limit, never a higher one; leave it empty to
use the platform's. It applies while students submit from the assignment's own pages, during its
exam, and in the contest.

## Time and memory limits

Each language has a time and memory limit per run, set by the platform (**Dashboard › Languages**).
An organization can change them for its own assignments, contests and members-only problems under
**Manage › Settings › Time and memory**: type a number to replace the default, or leave the box
empty to keep it. Anyone who can change the organization's settings can do this.

- **The platform's ceiling.** Nobody can go past **Highest time limit an organization may set** and
  **Highest memory limit an organization may set** (Dashboard › Settings › Execution; 10 seconds and
  1,024 MB to start). If the platform lowers them later, limits already saved are held under the new
  ceiling.
- **A problem's own limits win.** A problem written with its own time or memory limit keeps it; the
  organization's limit only replaces the language's default.
- **Personal practice** in the library keeps the platform's limits.
- A higher memory limit means each judge machine can run fewer submissions at once.
- Each submission keeps the limits it ran under, shown on its page, so changing them never changes
  results already given.

## Edge cases

- Hidden tests' **inputs** reach the student's browser in this mode (their expected outputs never
  do). Use it to keep work going while the judge is failing, not for an exam whose tests must stay
  closed.
- During a [lab exam](/features/coding/lab-exams/), fetching the tests needs the lab's network too.
- Templates don't carry this choice: each use of a template keeps its own, like its lab networks.
- Visitors who aren't signed in always run in the browser and can't submit.

## Related

- [Run and Submit](/features/coding/run-and-submit/)
- [Assignments and the gradebook](/features/coding/assignments/)
- [Contests](/features/coding/contests/)
- [Site settings](/features/platform/site-settings/)
