---
title: Reports
description: An organization's activity, assignment results and teaching progress by group, with CSV, paged on the server.
glance:
  who:
    - role: Owner and admin
    - role: Teacher
      note: their groups
  where:
    path: /orgs/<slug>/manage/reports
    menu: "School › Reports"
  permissions: [reports.view, gradebook.export]
  demo:
    as: the school's owner
    email: owner@greenwood.demo.invalid
    path: /orgs/greenwood/manage/reports
---

## What's in it

- **Figures** for the group chosen: students, active this week, assignment completion and averages.
- **Assignments:** each one's due time, how many started, and the average.
- **Students:** groups, last active, assignment marks and practice solved, a page of 100 at a time with
  search and a "No work this week" filter.

## What counts

Activity from the organization's own assignments and contests always counts. General practice counts
only for members who chose to share it with the organization. People with teaching permissions are left
out.

## Related

- [Assignments and the gradebook](/features/coding/assignments/)
- [Attendance](/features/daily/attendance/): the attendance report
