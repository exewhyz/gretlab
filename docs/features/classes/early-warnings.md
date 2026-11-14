---
title: Early warnings
description: Which students need attention in a class and why (missed work, low marks, gone quiet, attendance), with notes to them.
glance:
  who:
    - role: Teacher
      note: who can see the class's grades
  where:
    path: /orgs/<slug>/classes/<group>?tab=grades
    menu: "A class › Grades › Needs attention"
  permissions: [gradebook.view]
---

A class's Grades tab starts with **Needs attention**: each student flagged, and why. It's worked out on
every visit, never stored.

## The rules

| Signal | When |
| --- | --- |
| Missed work | A finished assignment set for them with nothing submitted and no quiz answer |
| Low marks | Under 40% on finished work, once two pieces have finished (weighted by points) |
| Gone quiet | Nothing submitted for 7 days while they have unfinished open work |
| Attendance | Under 75%, once four classes are marked |

One reason is **watch**; two or more (or two missed) is **at risk**. Due times count each student's
extension, and a handed-in project isn't missed work.

## Sending a note

Tick students and **Send a note**: they get it in the app and by email, from you. Only the class's
students can be sent one. The activity log records that a note was sent, not its words.

## Related

- [Class pages](/features/classes/class-pages/)
- [Attendance](/features/daily/attendance/)
