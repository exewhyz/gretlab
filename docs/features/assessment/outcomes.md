---
title: Course and program outcomes
description: Program outcomes per organization, course outcomes per class mapped to them, problems tagged with course outcomes, and attainment worked out from marks.
glance:
  who:
    - role: Owner and admin
      note: program outcomes and rules
    - role: Teacher
      note: their class's course outcomes
  where:
    path: /orgs/<slug>/manage/outcomes
    menu: "Academics › Outcomes; a class's Outcomes tab"
  permissions: [org.outcomes.manage, assignments.manage, gradebook.view]
---

Outcome-based education, as accreditation (NBA) expects it: **program outcomes** (POs), **course
outcomes** (COs) mapped to them, and attainment worked out from students' marks.

## How it works

- **Program outcomes** belong to the organization. "Start from NBA's PO1–PO12" fills a template to edit.
  The same page sets the **attainment rules**: by default a student reaches a CO at 60%, and the CO's
  level is 1, 2 or 3 when 50%, 60% or 70% of students reach it.
- **Course outcomes** belong to a class, each mapped to POs at strength 1–3. Editing keeps them by id,
  so tags and mappings follow.
- **Assignment problems are tagged** with the class's COs in the assignment form.
- **Attainment is computed, never stored:** per CO, each student's marks on tagged problems in published
  assignments; then the share reaching the threshold gives the level. A PO is its COs' levels weighted
  by mapping strength.

## Step by step

1. **Academics › Outcomes:** set the program outcomes and the attainment rules.
2. On a class's **Outcomes** tab, **Edit outcomes** opens a side sheet: write the COs and map each to
   POs.
3. Tag problems with COs when setting assignments.
4. Read the class's attainment report, and download it as CSV.

## Who sees what

Teachers who can see the class's grades get the report. Students don't see it.

## Related

- [Assignments and the gradebook](/features/coding/assignments/)
