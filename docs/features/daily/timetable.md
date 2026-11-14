---
title: Timetable
description: The organization's periods and school days, each class's week, and teachers who can't be in two classes at once.
glance:
  who:
    - role: Timetable coordinator
      note: periods and days
    - role: Teacher
      note: their own week
    - role: Student
      note: their class's week
  where:
    path: /orgs/<slug>/manage/timetable
    menu: "Academics › Timetable"
  permissions: [timetable.manage, timetable.periods, timetable.edit]
  module: timetable
  demo:
    as: the principal
    email: principal@greenwood.demo.invalid
    path: /orgs/greenwood/manage/timetable
---

One set of **periods** for the organization, its **school days**, and each class's **week**: cells
holding one of the subjects that class takes, so the teacher comes from Subjects.

## How it works

- **Periods** have a name, start and end times, and may be breaks. School days are Monday to Friday
  unless changed.
- **A cell** is one class, day and period, holding one of that class's subjects.
- **No clashes:** a teacher can't be in two classes in one period. Breaks and days off can't hold
  lessons.
- Saving periods keeps them by id, so cells survive; a period removed or turned into a break loses its
  cells.

## Step by step

1. **Academics › Timetable › Periods and days**: set the periods and the school days.
2. Pick a class and fill its grid with its subjects.
3. Teachers see their own week under **My timetable**; anyone who teaches or sits in a class sees its
   **Timetable** tab.

## Who sees what

| Who | Sees |
| --- | --- |
| "Set periods and days" (organization-wide) | Periods and school days |
| "Edit class timetables" for a class | That class's grid |
| Teachers | Their week, and their lessons on their home each day |
| Students and parents | Their class's week |

## Related

- [Attendance](/features/daily/attendance/)
- [Leave](/features/daily/leave/)
