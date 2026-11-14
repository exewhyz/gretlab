---
title: Admissions
description: Parents apply online; the office reviews, waitlists or admits, and admitting creates the student's record and links the parent.
glance:
  who:
    - role: Admissions officer
      note: runs admissions
    - role: Parent
      note: applies
  where:
    path: /orgs/<slug>/manage/admissions
    menu: "People › Admissions"
  permissions: [admissions.manage]
  module: admissions
---

The yearly intake, from the public "Apply for admission" link to a student's first day.

## How it works

- **Open or closed,** for one academic year and some or all classes, with instructions. When open,
  the organization's public page shows **Apply for admission**.
- **Applying:** applicants sign in (which keeps out spam and gives the account that becomes the
  parent) and apply at `/orgs/<slug>/apply`. One open application per child, five at once. Birth date,
  phone and address are encrypted at rest.
- **Numbers** run per year: `APP-2026-0001`.
- **The office** sees new applications counted in the menu and on the home's "Needs attention", and
  moves each to reviewing, waitlisted or not admitted, with a message the applicant is told.

## Admitting

Admitting makes the same student account, record, admission number and enrolment as adding a student
by hand, in the section chosen. They're placed in the class at once only if the year is current;
otherwise they join when it becomes current. The applicant is linked as their parent, and a student who
applied for themselves becomes their own record.

## Step by step

1. **People › Admissions:** open admissions for a year and choose the classes.
2. Review each application; waitlist or turn it down with a message, or **Admit** into a section.
3. Close admissions when the intake is done.

## Related

- [Student records](/features/people/student-records/)
- [Parent accounts](/features/people/parent-accounts/)
