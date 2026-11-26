---
title: Contests
description: Timed competitions with ICPC or IOI scoring, registration, a scoreboard that can freeze, and questions beside problems.
glance:
  who:
    - role: Teacher
      note: runs contests for their groups
    - role: Anyone signed in
      note: registers and competes
  where:
    path: /contests
    menu: "Learn › Contests"
  permissions: [contests.manage, contests.grade]
  module: coding
---

A contest is a timed competition on a set of problems (and questions that mark themselves), open to
everyone on the platform or aimed at an organization's groups.

## How it works

- **Registration:** contestants register before or during the contest.
- **Scoring:** **ICPC** (problems solved, then penalty time) or **IOI** (points, with partial credit).
- **Scoreboard freeze:** the board can stop updating near the end and reveal the final standings after.
- **Questions** are labelled after the problems (Q1, Q2). A registered contestant answers each once
  while the contest runs, marked at once; a right answer counts as a solve (ICPC) worth its points
  (IOI). Right answers show after the contest.
- An organization's contests use its own languages and paste rules.

## Step by step

1. **Coding lab › Contests › New contest** (or from a class, aimed at it).
2. Choose the start and end, the scoring and the freeze, and the audience.
3. Pick problems and questions; **Write a problem** and **Import problems** create ones only this
   contest uses.
4. Publish. Contestants register on the contest page.

## Ratings

A **rated** contest changes its contestants' contest rating once it ends:

- The platform's contests are rated unless the form's **Rated** box is unticked; an
  organization's contest only when it's ticked, so a class test never moves anyone's rating by
  accident.
- Everyone starts at 1500. Each contestant is compared with every other on the final standings: a
  better rank is a win, the same rank half a win, weighed against what their ratings expected.
  Newcomers move twice as fast for their first five rated contests, so they settle quickly.
- Only people who tried something are rated; registering alone doesn't count. Virtual attempts
  never are.
- Ratings are worked out once, from the final standings (the freeze lifted), in the order contests
  ended. The finished board shows each contestant's change, and profiles (seen by signed-in
  people) show the rating, a chart over time and each rated contest.

## Virtual contests

After a contest ends, anyone who could have entered it can **take it virtually** from its page:

- It runs on their own clock for the contest's length, starting when they press **Start**, and
  keeps running if they leave the page.
- Their leaderboard shows the real contestants **as they stood at the same minute** of the original
  contest, with them ranked among them; the freeze applies as it did live.
- Each person can take a contest virtually **once**, and not at all if they took part live (made a
  submission or answered a question during it). Only registering doesn't count.
- Afterwards the contest page shows where they'd have finished. The official results never change,
  and virtual work isn't counted in reports, gradebooks or the plagiarism check: it's stored as the
  person's own practice.
- Right answers to the contest's questions stay hidden from them until their attempt ends.

## Watching how code was written

Whoever runs a contest can open any cell of its leaderboard to see how that contestant wrote that
problem's code while the contest ran:

- The code is played back as it grew, saved every few seconds as they typed in the editor, with
  what changed at each step highlighted. Code from before or after the contest isn't shown.
- Their graded submissions are listed with the minute of each; pressing one shows the code as it
  was then.
- Steps where a lot of new code appeared in one save (more than anyone types in a few seconds) are
  pointed out as **probably pasted**. They're a reason to look, never proof: it may be the
  contestant's own code from elsewhere. Undoing back to earlier code, reformatting and the
  problem's starter code aren't counted.
- Contestants and anyone else can't open it. Every replay is recorded in the activity log.

The same paste markers appear in an assignment's **Playback** in the gradebook.

## Edge cases

- Problems written for a contest are reachable only once the contest starts.
- Content someone can't take part in answers "not found".

## Related

- [Problems and practice](/features/coding/problems-and-practice/)
- [Quizzes and the question bank](/features/coding/quizzes/)
