---
title: LTI 1.3
description: "Connect Moodle, Canvas, Blackboard or another LMS: launches sign people in to their class, deep linking picks an assignment, and grades go back."
glance:
  who:
    - role: Owner and admin
      note: connects the LMS
    - role: Teacher
      note: links assignments and sends grades
  where:
    path: /orgs/<slug>/manage/lms
    menu: "School › LMS (LTI)"
  permissions: [org.settings.lms, assignments.grade]
---

## Connecting

Under **School › LMS (LTI)**, enter what the LMS gives you (issuer, client ID, deployment IDs and its
auth, token and keyset addresses). The page shows the addresses to give the LMS: `/api/v1/lti/login`,
`/api/v1/lti/launch` (also deep linking) and `/api/v1/lti/jwks`.

## Launching

A launch is verified against the LMS's keys and its claims (issuer, audience, expiry, nonce, version,
deployment). The person is found by their LMS id or email, becomes a member and is signed in. In a
course linked to a class, learners are placed in the class and instructors get the Teacher role for it.
A link opens its assignment, else the class.

## Deep linking and grades

An instructor's deep-linking request lists the organization's published assignments; the choice goes
back to the LMS as a gradebook column out of the assignment's total. **Send grades to LMS** in the
gradebook posts each student's total to every linked column; students who never came through that LMS
are skipped and counted.

## Related

- [The organization API](/api/)
