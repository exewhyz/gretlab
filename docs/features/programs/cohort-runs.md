---
title: Cohort runs and mentors
description: Groups that run between dates with a lead each, weekly progress per learner by pod, and graduation certificates.
glance:
  who:
    - role: Program manager
      note: whole runs
    - role: Mentor
      note: their pods
    - role: Learner
      note: their cohort and week
  where:
    path: /orgs/<slug>/manage/progress
    menu: "Academics › Progress"
  permissions: [org.groups.manage, assignments.manage, gradebook.view]
---

For kinds whose groups run between dates (cohort programs, coaching institutes), and kinds where each
group has its own lead.

## How it works

- **A run's dates and lead** are set from the Groups page (**Dates & mentor**). A new lead who doesn't
  teach the group yet is given the kind's instructor role (Mentor) on it.
- **Where a run is:** upcoming with days to go, week N of M while running, or finished.
- **Progress:** each run with its week and its pods' mentors, and a run's page listing every learner's
  work handed in of work due, attendance, last activity and early warning, by pod. Program managers see
  whole runs; a mentor sees only the pods they can see grades for.
- **Graduation:** a run's page issues graduation certificates, once per learner per run.
- **Homes:** a learner sees their cohort, its week, their pod and mentor; a mentor sees the pods they
  lead.

## Related

- [Certificates](/features/classes/certificates/)
- [Early warnings](/features/classes/early-warnings/)
