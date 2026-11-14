---
title: Student records
description: Academic years, admission numbers, enrolments with a section and roll number, import from a file, and promotion to the next year.
glance:
  who:
    - role: Office staff
      note: adds and edits records
    - role: Teacher
      note: sees their classes' records
  where:
    path: /orgs/<slug>/manage/students
    menu: "People › Students; Academics › Academic years"
  permissions: [students.manage, students.view, students.edit, students.years]
  module: records
  demo:
    as: office staff
    email: office@greenwood.demo.invalid
    path: /orgs/greenwood/manage/students
---

A student's **record**: their admission number and personal details, and an **enrolment** per academic
year saying which section they're in, their roll number and their status.

## How it works

- **Academic years** have start and end dates; one is current.
- **Places follow the current year.** Its active enrolments are who sits in which class, so registers,
  timetables, class pages and parents all follow. Making another year current moves everyone at once;
  their history stays.
- **Personal details** (birth date, phone, address) are encrypted at rest and logged only as "changed",
  never their values.
- **Students who don't sign in** (young children) still get an account, on an address nothing can ever
  sign in to or email.

## Step by step

### Add students

1. **People › Students › Add** for one, or **Import** a CSV (every row is checked first, and nothing is
   written unless all pass).
2. Choose a section of the current year and a roll number; an admission number is suggested.

### Promote to the next year

1. **Academic years › Promote students:** choose the from-year and the to-year.
2. Each section is suggested a destination (the same-named section of the next grade; the top grade
   graduates). A section can repeat, graduate or withdraw instead, and single students can be
   exceptions.
3. Preview the counts, then apply, optionally making the new year current. Running it twice is safe.

## Edge cases

- People who were in classes before the module have no record yet; a banner offers **Create records**.
- A student's status can be transferred, graduated or withdrawn, and restored.

## Related

- [Members, groups and roles](/features/people/members-groups-roles/)
- [Exams and report cards](/features/assessment/exams-and-report-cards/)
