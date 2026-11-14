---
title: Staff attendance
description: A daily register of teachers and staff, self check-in with a late time, approved leave on the register, and a month report.
glance:
  who:
    - role: Office staff
      note: marks the day
    - role: Staff
      note: checks themselves in
  where:
    path: /orgs/<slug>/manage/staff-attendance
    menu: "Every day › Staff attendance; My attendance"
  permissions: [staff_attendance.mark, staff_attendance.view]
  module: staffAttendance
---

A register for the people who work at the organization: one row per person per day.

## How it works

- **Staff** means active members whose roles grant something; students never show.
- **Statuses:** present, late, half day, absent and on leave, with the time they came in and a note.
- **Self check-in:** staff check themselves in for today, once. After the late time (09:00 unless
  changed) it counts as late. The office can switch self check-in off.
- **Approved staff [leave](/features/daily/leave/)** shows as **On leave**, starts the person as on
  leave and fills the month report.
- **The month:** a grid with totals and percentages; leave is left out, a half day counts half.

## Step by step

1. **Every day › Staff attendance › Day:** mark each person with the buttons, add a time or note, and
   save. Only the people you change are saved.
2. **Month:** the grid for any month.
3. Staff see their own check-in and month under **My attendance**, and today's check-in on their home.

## Edge cases

- No future days. Checking in twice, or after the office marked you, is refused.
- No check-in is asked for on a [day off](/start-here/glossary/#day-off).

## Related

- [Leave](/features/daily/leave/)
- [Attendance](/features/daily/attendance/)
