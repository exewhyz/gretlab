---
title: Notifications and email
description: The bell and email, decided at three levels (platform, organization, person), sent through an outbox with retries, plus a weekly summary for owners.
glance:
  who:
    - role: Everyone
      note: chooses what reaches them by email
    - role: Owner and admin
      note: the organization's switches
    - role: Communications
      note: the platform's switches and email wording
  where:
    path: /notifications
    menu: "The bell › Settings; Manage › Notifications; Dashboard › Notifications"
  permissions: [org.notifications.manage, platform.notifications.manage]
---

## Three levels

Every notification belongs to an event (new work, marks and feedback, more time, a class notice, a
teacher's note, a certificate, peer review, a discussion reply, a colleague's published work, a request
to join, the weekly summary). Per event, each level has three switches: **in the app**, **by email**,
and **people may choose** whether the email reaches them.

1. **The platform** decides what may be sent at all.
2. **Each organization** chooses within that.
3. **Each person** chooses which emails reach them (`/notifications`, from the bell).

A switch is on only if every level has it on, so what the platform turns off, an organization can't
use. A new event is on everywhere until someone turns it off.

## How email is sent

Email goes through an **outbox**, never straight from a request: the notification and its email are
written together, then sent just after the response, in batches, with retries (1 minute, 5 minutes,
30 minutes, 2 hours, 6 hours, then failed). A scheduler calling the outbox route finishes big batches
and retries. Sign-in codes and security notices jump the queue.

## Reminders

Work due within a day, a contest starting within a day, low attendance, books due: worked out when the
bell is opened, never stored, so no scheduler is needed.

## The weekly summary

On Monday morning, owners and admins get one email: requests waiting, new members, work published,
solutions submitted, notices, certificates and what's due. A week with nothing to say sends nothing.

## Related

- [Notices](/features/daily/notices/)
