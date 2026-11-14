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
  demo:
    as: a student
    email: student@greenwood.demo.invalid
    path: /contests
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

## Edge cases

- Problems written for a contest are reachable only once the contest starts.
- Content someone can't take part in answers "not found".

## Related

- [Problems and practice](/features/coding/problems-and-practice/)
- [Quizzes and the question bank](/features/coding/quizzes/)
