---
title: Problems and practice
description: The public problem library, members-only problems, the daily challenge, lists, study plans, profiles and the leaderboard.
glance:
  who:
    - role: Anyone signed in
      note: practises
    - role: Teacher
      note: writes their organization's problems
    - role: Content admin
      note: the platform's library
  where:
    path: /problems
    menu: "Learn › Problems"
  permissions: [problems.manage, platform.library.manage]
  module: coding
  demo:
    as: a student
    email: student@greenwood.demo.invalid
    path: /problems
---

Practice is the open half of the lab: a library of problems anyone can read and anyone signed in can
solve, with the daily challenge, personal lists and a leaderboard around it.

## How it works

- **The library.** The platform's problems, grouped into units (Unit 1 · Basics, …), each with a
  difficulty, tags, starter code and a reference solution in every language. Public problem pages need
  no account, so search engines can read them.
- **Running code.** Signed-in people run code on the server's judge. Visitors run Python in the browser
  (Pyodide) and are asked to sign in to submit.
- **Members-only problems** belong to one organization: never in the public library, the daily
  challenge or profiles. Members solve them at `/orgs/<slug>/practice/<problem>`.
- **Problems written for an assignment, exam or contest** are unlisted: reached only through the work
  that uses them, once it opens.
- **Statements are Markdown**, with input format, output format and constraints kept as their own
  fields and samples taken from the tests. Raw HTML is shown as text, never run, so organizations can
  write problems safely. Images are uploaded and served by Gretlab itself.

## Around the library

- **Daily challenge:** a problem, a question, or both, each day; solving it keeps your streak.
- **Hints and editorials:** hints open one at a time; editorials and reference solutions unlock once you
  solve the problem (when the platform turns that on). They're never in page data before that.
- **Notes, favourites and lists:** private to you. A list is visible to others only when staff publish
  it as a study plan.
- **Profiles and the leaderboard:** solved counts by difficulty, a heatmap and badges. The
  [leaderboard](/start-here/glossary/#switcher) follows the organization switcher.

## Step by step

### Practise a problem

1. Open **Problems** and filter by difficulty, tag, unit or status.
2. Open a problem, read the statement and samples, and write code in the editor (your draft saves as
   you type and follows you to any computer).
3. **Run** to try the samples or your own input, then **Submit** to grade it. See
   [Run and Submit](/features/coding/run-and-submit/).

### Write a problem for your organization

1. Go to **Manage › Problems › New problem** (needs "Write problems").
2. Write the statement in Markdown, add tests (mark which are samples) and, per language, starter code
   and a reference solution. "Generate from the reference solution" drafts starter code for you.
3. Publish it. Choose **members only** to keep it inside the organization.

To bring many in at once, use **Import** with the [problem file format](/problem-format/).

## Who sees what

| Who | Sees |
| --- | --- |
| A visitor | Public problem pages; runs Python in the browser |
| Anyone signed in | The public library, the daily challenge, profiles and the leaderboard |
| A member | Also their organization's members-only problems |
| Problem writers | Drafts they wrote, and every test including hidden ones |
| Students | Hidden tests' verdict and timing only, never input, output or expected output |

## Edge cases

- With **server execution off** in platform settings, signed-in students run in the browser and Submit
  is paused; they're never told to sign in.
- A problem used in work can't be put in other work unless its owner allows it.
- Lists of other people's private problems or lists answer "not found", not "not allowed".

## Related

- [Run and Submit](/features/coding/run-and-submit/)
- [Problem file format](/problem-format/)
- [Assignments and the gradebook](/features/coding/assignments/)
