---
title: Quizzes and the question bank
description: Single and multiple choice, short-answer and written questions, used in assignments, exams, contests and the daily challenge.
glance:
  who:
    - role: Teacher
      note: writes questions and marks written answers
    - role: Student
      note: answers them
  where:
    path: /orgs/<slug>/manage/questions
    menu: "Coding lab › Questions"
  permissions: [problems.manage, assignments.grade]
  module: coding
---

Quiz questions live in a **question bank**, owned like problems (by the platform or one organization),
and are used in assignments, lab exams, contests and the daily challenge, alone or beside coding
problems.

## Kinds of question

| Kind | Marked |
| --- | --- |
| Single choice | Automatically |
| Multiple choice | Automatically; needs exactly the right set |
| Short answer | Automatically when it matches an accepted answer (ignoring case, spacing and a final full stop); otherwise by a teacher |
| Written | Always by a teacher |

## How it works

- **Answers save as students type** and can be changed until their time is up (their personal due time,
  or the end of their exam sitting). Whatever is saved then counts. There's no separate submit step.
- **Results:** students see marks, the right answers and explanations after their due time, unless
  "Hold results until I release them" is on; then at **Release results**. Right answers are never in
  the page data before that.
- **In contests,** only questions that mark themselves can be used; each is answered once while the
  contest runs, and a right answer counts as a solve.
- **In the daily challenge,** one answer a day; a right answer keeps the streak.

## Step by step

1. **Coding lab › Questions** to write one, or **Import** with the [question file format](/question-format/).
2. In an assignment, exam or contest form, use the question picker beside the problem picker, giving
   each question its points.
3. Mark written and unmatched short answers from the gradebook's **Quiz** column. A teacher's mark
   replaces the automatic one; clearing it goes back to automatic.

## Edge cases

- A question used anywhere can't be deleted.
- Organizations can also pick the platform's ready questions.

## Related

- [Question file format](/question-format/)
- [Assignments and the gradebook](/features/coding/assignments/)
