---
title: GitHub projects
description: Project work in assignments, handed in as a GitHub repository pinned to a commit, and marked from the gradebook.
glance:
  who:
    - role: Teacher
      note: sets and marks projects
    - role: Student
      note: hands in a repository
  where:
    path: /assignments/<slug>
    menu: "An assignment's Projects section"
  permissions: [assignments.manage, assignments.grade]
  module: coding
---

An assignment (not an exam) may have projects: a title, Markdown instructions and points. An assignment
can be projects only.

## How it works

- **Handing in:** students give a GitHub repository link. Links are checked strictly (github.com only,
  GitHub's naming rules, an optional `/tree/<branch>` or `/commit/<sha>`).
- **Pinned to a commit:** a commit link as given, otherwise the branch's current commit from GitHub. If
  GitHub says "not found", it's refused (private repositories must be shared with the teacher); if
  GitHub can't be reached, it's saved unpinned.
- **Timing:** open from when the assignment opens until the student's own due time; later only when late
  work is allowed, marked late. Handing in again replaces the work and clears its mark.
- **Marking** from the gradebook's Projects column: a mark up to the points, and Markdown feedback.
  Marks count in totals and the CSV.

## Related

- [Assignments and the gradebook](/features/coding/assignments/)
