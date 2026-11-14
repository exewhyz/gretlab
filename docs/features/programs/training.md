---
title: Assigned training
description: A course assigned to a department or team with a due date and renewal, statuses from due to expired, reminders and certificates that expire.
glance:
  who:
    - role: L&D admin
      note: assigns and tracks training
    - role: Manager
      note: their teams
    - role: Employee
      note: does it
  where:
    path: /orgs/<slug>/manage/training
    menu: "Academics › Training"
  permissions: [assignments.manage, gradebook.view]
  module: training
---

A [course](/features/coding/courses/) given to a department or team with a **due date** and, for
compliance, **renewal every N months**.

## Statuses

| Status | Meaning |
| --- | --- |
| To do | Not done, not due soon |
| Due | Due within 7 days |
| Overdue | Past its due date |
| Done | Finished and valid |
| Expiring | Valid, but expires within 30 days |
| Expired | Its renewal period passed; it asks again |

With renewal, work older than the renewal period stops counting, so the person redoes it. It's valid
until their oldest item's last completion plus the renewal.

## Step by step

1. **Academics › Training:** each training with how many are done, late or due soon.
2. Open one: each person, their team, progress, status, needed-by date and valid-until date, with
   **Remind**, **Certify finished**, and **Change** or **Remove**.

## Who sees what

L&D admins see everything; a manager sees the teams they see grades for; employees see their own on
their home and in the bell when overdue, due within a week, expired or expiring.

## Related

- [Courses](/features/coding/courses/)
- [Certificates](/features/classes/certificates/)
