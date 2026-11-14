---
title: Leave
description: Students, parents and staff ask for leave; the class teacher or the office decides; approved leave excuses absences.
glance:
  who:
    - role: Student or parent
      note: asks for the student
    - role: Staff
      note: asks for themselves
    - role: Class teacher
      note: decides their class's
    - role: Office
      note: decides staff leave
  where:
    path: /orgs/<slug>/leave
    menu: "This school › Leave"
  permissions: [leave.manage, leave.students, leave.staff]
  module: leave
  demo:
    as: a parent
    email: parent@greenwood.demo.invalid
    path: /orgs/greenwood/leave
---

One place to ask for leave and decide it, for students and for staff.

## How it works

- **Student leave** is asked by the student or a linked parent, with a reason (sick, family, event or
  other).
- **Staff leave** is asked by the staff member, of a kind the school sets: Casual 12 days, Sick 10,
  Earned 15 and Unpaid with no limit, by default.
- **Days** count only school days, half days count 0.5, and a request is at most 90 days long and at
  most 30 days after the fact.
- **Who decides:** student leave goes to the student's class teacher for the current year (or anyone
  with "Approve student leave"); staff leave to "Approve staff leave". Nobody decides their own.
- **Balances** count approved and waiting staff days in the current academic year; a request beyond
  what's left, or overlapping other leave, is refused.

## What approving does

- The student's **absent** marks in those days become **excused**.
- Registers start them as excused with an **On leave** tag.
- Parents aren't sent absence alerts for a day their child is on approved leave.
- For staff, the staff register shows **On leave**.

## Step by step

1. **Leave › Ask for leave**: choose who it's for, the days (half days allowed) and the reason.
2. The decider is told; it appears in their **To decide** tab and their home's to-dos.
3. They approve or refuse (with a reason). A request can be taken back while waiting, or before
   approved leave starts.

## Related

- [Attendance](/features/daily/attendance/)
