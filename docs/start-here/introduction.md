---
title: Introduction
description: What Gretlab is, who it's for, what it does, and how these docs are organized.
---

**Gretlab** is one place where a learning organization runs its day and its people learn, with a
coding lab built in. A school takes registers, sets timetables, approves leave, keeps student
records and prints report cards. A college does the same by course and semester. A coaching
institute, a cohort program, a company's training team or a community runs its own way. And all of
them can set programming work that's judged by running students' code in a sandbox.

Many organizations share one Gretlab, but each only ever sees its own data. A person keeps one
account and can belong to several organizations: a college, a company and a club, say.

## Who it's for

Every role is a first-class user. Each works inside their own organization and sees only what their
roles open.

- **People who run an organization:** owners, principals, deans, centre heads, office staff, exam
  cells, librarians and organizers. Their work is people, groups, attendance, exams and marks,
  leave, admissions, the library, transport, the hostel, training, events and reports. Mostly on a
  laptop.
- **People who teach or lead a group:** teachers, faculty, mentors, managers and moderators. They take
  registers, log classes, set and grade work, post notices and follow their students.
- **Members:** students, learners, employees and community members. They check their week, work due,
  results, attendance, training and events. Often on a phone.
- **Parents:** follow each child's attendance, timetable, marks, bus, library and notices, and ask
  for leave. Mostly on a phone.
- **Coding learners:** anyone signed in. They practise problems in the browser editor, run and submit
  code to the judge, and take assignments, contests and the daily challenge.
- **Platform staff:** the people who run the site itself, its content library and its organizations.

[Roles at a glance](/start-here/roles-at-a-glance/) covers each in detail.

## The two halves

**The day.** Everything an organization does every day, switched on as modules to suit its kind:
attendance, the timetable, subjects, leave, staff attendance, student records, admissions, exams and
report cards, parent accounts, the library, transport, the hostel, holidays, training and events.

**The lab.** A real code-execution judge. Problems with hidden tests run in throwaway gVisor sandboxes.
Students **Run** code on the samples and **Submit** it to be graded. Teachers set assignments, timed
lab exams that lock the site to the exam, and contests, with rubrics, line comments, peer review and
plagiarism checks.

The two meet in one place: a class page has its stream, its work, its grades, its attendance and its
discussion together.

## How these docs are organized

- **Start here** explains Gretlab: how it works, the roles, the kinds of organization, the words.
- **Features** is a page per feature: who uses it, where it is, the permissions behind it, how it
  works and how to do each thing.
- **Guides** are formats and integrations: importing problems and questions, and the organization
  API.
- **Setup & operations** is for the people who install and run Gretlab.
- **Reference** lists roles, permissions, kinds and modules (read from the app itself, so always
  current) and the demo accounts.

## Try it with the demo data

The quickest way to understand Gretlab is to sign in to the demo. One command builds an organization
of each kind (a school, a college, a coaching institute, a cohort program, a company and a community)
with a few months of realistic activity, and a sign-in for every role. See
[Demo data](/setup/demo-data/) and [Demo accounts](/reference/demo-accounts/).

## Where the truth lives

These docs explain; the code decides. The rules behind a feature live in `packages/judge` (pure,
unit-tested) and its server code in `apps/web/features/<name>`. The reference pages here are generated
from `packages/judge`, so they match the app you're running. `AGENTS.md` at the repository root is
the project's own record of every decision.
