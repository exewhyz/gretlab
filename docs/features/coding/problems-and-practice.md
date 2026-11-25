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
---

Practice is the open half of the lab: a library of problems anyone can read and anyone signed in can
solve, with the daily challenge, personal lists and a leaderboard around it.

## How it works

- **The library.** The platform's problems, grouped into units (Unit 1 · Basics, …), each with a
  difficulty, tags, starter code and a reference solution in every language. Public problem pages need
  no account, so search engines can read them.
- **Running code.** Signed-in people run code on the server's judge. Visitors run Python (Pyodide) and
  JavaScript in the browser and are asked to sign in to submit.
- **Members-only problems** belong to one organization: never in the public library, the daily
  challenge or profiles. Members solve them at `/orgs/<slug>/practice/<problem>`.
- **Problems written for an assignment, exam or contest** are unlisted: reached only through the work
  that uses them, once it opens.
- **Readable addresses.** A problem's address comes from its title: `/problems/integer-operations`.
  If it changes, the old address keeps working: visitors, links and search engines are sent on with a
  permanent redirect, and the API still accepts it. An address one problem has or had can't be given
  to another.
- **Topic pages.** Every tag with a public problem has a page, `/problems/topics/<tag>`, listing its
  problems easiest first, and `/problems/topics` lists them all. They build themselves from the
  library: tag a problem and its topic appears. A problem's tags link to their topic.
- **Statements are Markdown**, with input format, output format and constraints kept as their own
  fields and samples taken from the tests. Raw HTML is shown as text, never run, so organizations can
  write problems safely. Images are uploaded and served by GretLab itself.

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

1. Open **Problems** and filter by difficulty, tag, unit or status, or choose **Browse by topic**.
2. Open a problem, read the statement and samples, and write code in the editor (your draft saves as
   you type and follows you to any computer).
3. **Run** to try the samples or your own input, then **Submit** to grade it. See
   [Run and Submit](/features/coding/run-and-submit/).

### Write a problem for your organization

1. Go to **Coding lab › Problems › New problem** (needs "Write problems").
2. Write the statement in Markdown, add tests (mark which are samples) and, per language, starter code
   and a reference solution. "Generate from the reference solution" drafts starter code for you.
3. Publish it. Choose **members only** to keep it inside the organization.

To bring many in at once, use **Import** with the [problem file format](/problem-format/).

### Share and read solutions

On a library problem, the **Solutions** tab holds solutions students have shared:

- Once you've solved the problem, **Share your solution**: pick one of your accepted submissions
  (so everyone knows it passes) and explain how it works. One post per problem; writing again
  edits it, and you can delete it.
- You can read posts once you've solved the problem (or whenever editorials are open before
  solving, if the platform allows that). Before then the tab only says how many there are.
- Vote a post up (not your own), comment on it, or **Report** it. Its author is told about
  comments.
- Posts are closed while a contest uses the problem and during an exam, and never appear on
  assignment, exam, contest-only or members-only problems.
- Platform staff with **Moderate solution posts** see reported posts first under
  **Dashboard › Solution posts** and hide them; hiding is logged. The platform can switch solution
  posts off under Settings.

### Decide how output is checked

By default a program's output must match the expected output exactly (trailing spaces and blank
lines at the end never matter). For problems with more than one right way to print the answer,
tick what's allowed under **How output is checked** in the problem editor; the options combine:

- **Ignore spacing:** compared value by value, so spaces and line breaks between values don't
  matter.
- **Numbers within a tolerance:** numbers are read as numbers, whatever their spelling
  (`2.5E+3` matches `2500`), and accepted within an absolute or relative tolerance. Words stay
  exact; things that aren't decimal numbers (`0xFF`, `inf`) are words.
- **Lines in any order:** the same lines, each as often as expected.
- **Ignore case:** `YES` and `yes` count as the same. Only words; numbers are never affected.

Students see one line on the problem saying what's accepted. Each submission keeps the rule it was
judged by, so changing it later never changes results already given. Problems whose answers need
real checking (any valid shortest path) aren't covered yet.

### Group tests into subtasks

Give tests the same **Group** name (for example "Small inputs" and "Large inputs") to score them
together, the way programming olympiads give partial marks:

- A group is worth the sum of its tests' points and earns them **only when every test in it
  passes**. The editor shows each group's tests and total as you type.
- Once a test in a group fails, the group's remaining tests are **Skipped**: they can't change its
  score, so the judge doesn't spend time on them.
- Tests without a group score one by one, as before; "Accepted" still means every test passed.
- Students see each group's points and where it failed on their submission, never the hidden tests
  themselves. IOI contests and assignments' partial credit use the groups' score.
- Changing groups affects new submissions only; earlier ones keep the score they were given.

## Who sees what

| Who | Sees |
| --- | --- |
| A visitor | Public problem pages; runs Python and JavaScript in the browser |
| Anyone signed in | The public library, the daily challenge, profiles and the leaderboard |
| A member | Also their organization's members-only problems |
| Problem writers | Drafts they wrote, and every test including hidden ones |
| Students | Hidden tests' verdict and timing only, never input, output or expected output |

## Edge cases

- With **server execution off** in platform settings, signed-in students run Python and JavaScript in
  the browser; they're never told to sign in. Submit is paused unless **Grade in the browser** is on,
  which grades practice provisionally (see [Where code runs](/features/coding/where-code-runs/)).
- A problem used in work can't be put in other work unless its owner allows it.
- Lists of other people's private problems or lists answer "not found", not "not allowed".
- Changing a problem's address in the editor is refused if another problem has or had it ("Choose
  another"). `topics` is reserved for the topic pages.
- Progress saved in a visitor's browser under an old address moves to the new one on their next
  visit.

## Related

- [Run and Submit](/features/coding/run-and-submit/)
- [Problem file format](/problem-format/)
- [Assignments and the gradebook](/features/coding/assignments/)
