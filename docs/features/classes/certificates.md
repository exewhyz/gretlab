---
title: Certificates
description: Certificates for finishing a course or written by a teacher, each with a public page anyone can open to verify it.
glance:
  who:
    - role: Teacher
      note: issues certificates in their class
    - role: Student
      note: keeps theirs under My certificates
    - role: Anyone
      note: verifies one
  where:
    path: /certificates/<code>
    menu: "A class › Course › Certificates; account menu › My certificates"
  permissions: [assignments.manage]
  demo:
    as: a cohort graduate
    email: graduate@launchpad.demo.invalid
    path: /certificates
---

## How it works

- **For finishing a course:** every item done, once per student per course.
- **Written by a teacher** for chosen students of the class.
- **Graduation** certificates for a [cohort run](/features/programs/cohort-runs/), and **training**
  certificates that expire with renewal.
- **A public code** (`ABCDE-23456`, without 0, O, 1, I or L) and a page at `/certificates/<code>` that
  anyone can open without signing in: the name (never the email), title, organization, issuer, date, and
  whether it's valid, revoked or expired. It prints as the certificate.
- **Revoking** keeps the record and says so on the page. Issuing and revoking are logged.

## Related

- [Courses](/features/coding/courses/)
