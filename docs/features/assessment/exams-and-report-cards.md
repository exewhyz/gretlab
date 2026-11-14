---
title: Exams and report cards
description: Term exams with a paper per subject per section, marks by the subject teacher, the school's grading scale or a college's credits, remarks and printable report cards.
glance:
  who:
    - role: Exam coordinator
      note: sets up exams and publishes
    - role: Subject teacher
      note: enters their papers' marks
    - role: Class teacher
      note: writes remarks
    - role: Student and parent
      note: read published report cards
  where:
    path: /orgs/<slug>/manage/exams
    menu: "Academics › Exams"
  permissions: [exams.manage, exams.setup, exams.marks, exams.remarks, exams.view]
  module: exams
---

Term exams for schools and colleges (the lab's timed exams are [Lab exams](/features/coding/lab-exams/),
a different thing). Needs Student records and Subjects switched on.

## How it works

- **An exam** belongs to an academic year (and optionally a term or semester) with an optional weight
  toward the year's result.
- **Papers:** adding papers for sections or grades gives each section a paper for every subject it
  takes. Running it again adds nothing new.
- **Who sits a paper** comes from the exam year's enrolments, so last year's results stay right after
  promotion.
- **Marks** are whole or half, up to full marks, or **absent** (counted as 0 and a fail). Any paper left
  unmarked makes the result "incomplete".
- **Grading:** schools grade by marks on a scale (CBSE's A1–E by default); colleges by credits, with a
  grade card per semester, SGPA and a CGPA weighted by credits.

## Publishing

Publishing tells each student and their parents, and locks the exam's marks, papers and remarks.
It's refused while marks are missing, unless forced. Unpublishing unlocks them.

## Step by step

1. **Academics › Exams › New exam**, then **Add papers** for the sections or grades sitting it.
2. Subject teachers open each paper and enter marks: Enter moves to the next student, and bad marks are
   flagged before saving.
3. Class teachers write each student's overall remark (with a comment bank); subject remarks go with
   the marks.
4. Check the **Results** tab (each class's table, figures and ranks), then **Publish**.
5. Download a class's report cards as a PDF from the Results tab.

## Who sees what

| Who | Sees |
| --- | --- |
| A paper's subject teacher | That paper's marks, and no other subject's |
| "Enter marks" for a class | Its papers |
| Staff | Drafts, marked as drafts |
| A student and their parents | Only their own report card, only published exams |
| Anyone else | "Not found" |

## Related

- [Student records](/features/people/student-records/)
- [Kinds and modules](/reference/kinds-and-modules/)
