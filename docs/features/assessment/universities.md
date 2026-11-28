---
title: Universities and affiliated colleges
description: A university's affiliated colleges, its common syllabus, student registration, university exams and results, shared content and the oversight dashboard.
glance:
  who:
    - role: Vice chancellor or registrar
      note: affiliates colleges, sets the syllabus, approves registrations
    - role: Controller of examinations
      note: sets university exams, enters external marks, publishes results
    - role: College office and faculty
      note: put classes on the syllabus, register students, enter internal marks
  where:
    path: /orgs/<slug>/manage/colleges
    menu: "Academics › Affiliated colleges"
  permissions: [university.manage, university.colleges, university.syllabus, university.registrations, university.exams, university.share, university.view]
  module: affiliation
---

An affiliating university sets the syllabus, registers students, holds the end-semester exams and
publishes results for colleges that each run their own day. In GretLab the university and each
college are separate organizations, linked by an **affiliation**. The college keeps its own members,
classes, timetable, attendance, fees and exams; the university reaches into it only for academics.

## What a university sees in its colleges

Academics, student by student: registrations, internal and university marks, results, attendance
figures and coding lab use. **Never** a college's fees, parents, hostel, transport, leave or staff
details. It reaches a college only while the affiliation is active; ending it cuts access at once.
Published results already on students' report cards stay there.

## Affiliation

1. A college opens **Manage › University** and asks to affiliate by the university's address.
2. The university approves it under **Academics › Affiliated colleges**, giving it a **college code**
   (2 to 10 letters and digits, like `FC1`), or refuses it.
3. Either side can end it later. Each step is in both organizations' activity logs, and the other
   side is told.

## The common syllabus

- Under **Academics › Syllabus** the university sets each program's semesters: its own courses (with
  credits), each with internal marks (the college's), external marks (the university's), the
  external pass mark and the total pass mark.
- A college puts a class on a program's semester under **Manage › University**. The class takes those
  courses, marked **University** under Subjects: their name, code and credits follow the
  university's and can't be changed while affiliated; the college chooses who teaches each.

## Registration

- A college registers a class's students (or chosen ones) for a program and admission year. Only
  students with a [student record](/features/people/student-records/) are registered.
- The university approves them under **Academics › Registrations**, giving each a number: the
  college code, the year and a sequence (`FC120260001`), shown on the student's record. It sees the
  student's name and the college's admission number, never their email.

## University exams and results

- Under **Academics › University exams** the university sets an exam for a program's semester. It
  reaches every affiliated class on that semester; those sitting it are its registered students.
- Colleges enter **internal marks** for their classes until the university closes them. The
  university enters **external marks**, or imports them as a CSV of registration number, course
  code and marks (AB for absent).
- A course passes with the external and the total pass marks, graded on the university's scale (the
  UGC ten-point one by default); an absence or a fail is a backlog. Each semester has an SGPA, and
  the CGPA weighs the published semesters by credits.
- **Publishing** (a protected action) tells students and their parents; the report card and its PDF
  show **University results**. A mark changed after publishing is logged as a correction.

See [Exams and report cards](/features/assessment/exams-and-report-cards/) for the college's own
exams, which stay separate.

## Shared content

A university shares its own problems, questions, courses and templates with its affiliated
colleges (**Share with colleges** in its Library, Courses and Templates). Colleges use them in their
own work while affiliated. See [The content library](/features/coding/content-library/).

## Oversight

**Academics › Oversight** shows each affiliated college: registered students, attendance over the
last 90 days, the pass rate of the latest published results, and coding lab use over 30 days. Open a
college for its registered students with the same.

## Plans

Affiliated colleges is a plan feature for universities, in the University plan. Each college
pays for its own plan.

## Related

- [Kinds of organization](/start-here/kinds-of-organization/)
- [Subjects](/features/assessment/subjects/)
- [Student records](/features/people/student-records/)
