---
title: Courses
description: Modules of readings, library problems and questions with release rules, given to classes from a start day, with an optional graded quiz, lab and project per module.
glance:
  who:
    - role: Teacher
      note: gives courses to their classes
    - role: Student
      note: works through the modules
  where:
    path: /orgs/<slug>/manage/courses
    menu: "Academics › Courses; a class's Course tab"
  permissions: [assignments.manage]
---

A course is an ordered outline of modules, each an ordered list of readings (lesson pages you write
in the course), library problems and questions for practice nobody marks. A module can also have a **quiz**, a **lab** and a **project**, which are
graded and make up the course grade.

## How it works

- **Readings:** lesson pages written in markdown (headings, lists, tables, code, images) in the
  module itself. Students read them on their own page, with the module's other items beside it,
  **Previous** and **Next** through the course, and **Mark as completed**.
- **What a course may hold:** public library problems, other ready problems the owner may use, and
  questions that mark themselves. Drafts, assessment-only problems and written questions are refused.
- **Given to a class from a start day.** A module opens a number of days after the start, and, if set,
  only once the student finished the module before.
- **Progress is computed:** a reading is done once marked completed, a problem with an accepted
  submission, a question with a right answer (tries again allowed; the answer shows once right or
  after three tries).
- **Quiz, lab and project (optional, one of each per module):**
  - A **quiz** holds questions that mark themselves, each worth the points you give it.
  - A **lab** holds ready library problems, each worth points. A problem scores by the student's best
    graded submission made during their attempt; work from before doesn't count.
  - A **project** is a brief students hand in as a GitHub repository link, pinned to its commit. A
    teacher marks it out of its points, with feedback.
  - Quizzes and labs are **one attempt**, with or without a time limit. The clock starts at **Start**
    and keeps running if the student leaves the page. Without a limit, the attempt runs until they
    press **Finish**. Quiz answers save as they go; right answers show once the attempt is over.
- **The course grade:** each quiz, lab and project counts by its weight (the share of each is shown
  on the grade sheet). A quiz or lab counts once its attempt is over, a project once it's marked;
  until then it counts 0. "So far" leaves out what isn't final.
- **Finishing a module** includes its quiz and lab (attempt over) and project (handed in).
- **Platform courses** are shared with organizations; an organization gives them to classes, or copies
  one to change it. **Make a copy** also copies your own course ("… (copy)"), for example to run a
  new round whose students start afresh while the old round's work stays.

## Step by step

1. **Academics › Courses › New course:** add modules, and open each to write its readings
   (**Write a reading**) and choose its problems and questions.
2. In a module, tick **Add a quiz**, **Add a lab** or **Add a project** where they fit. Name each,
   add instructions, a time limit and a weight, and choose its questions or problems with their
   points (a project: what it's out of).
3. On a class's **Course** tab, give it a course and a start day.
4. Teachers see every module and how many finished; students see modules as they open and take
   their quizzes, labs and projects from them.
5. **Grades** on the course (class's Course tab) lists each student's scores and course grade. Click a
   score to mark a project or let a student take a quiz or lab again.

## Edge cases

- A course in use can't be deleted; taking it off a class keeps students' work.
- Readings belong to the course: a copy gets its own copies, and taking a reading out of the outline
  deletes it, with who had read it.
- Editing a module keeps its quiz, lab and project (and students' attempts and marks) as long as
  each stays in the module. Unticking one deletes it with its attempts and marks.
- Marking projects and resetting attempts needs "Grade" for the class (`assignments.grade`), and
  both go in the activity log.
- Lab problems are solved on their own pages; only graded submissions (Submit, not Run) count.

## Related

- [Certificates](/features/classes/certificates/)
- [The content library](/features/coding/content-library/)
