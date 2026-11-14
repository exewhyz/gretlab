---
title: Events and open groups
description: Events for everyone or one group, with a place or online link, capacity and a waitlist; groups members join themselves.
glance:
  who:
    - role: Event organizer
      note: runs events
    - role: Moderator
      note: their group's events
    - role: Member
      note: says they're going
  where:
    path: /orgs/<slug>/events
    menu: "Events; Groups"
  permissions: [events.manage, org.groups.manage]
  module: events
---

## Events

- **For everyone or one group** (and the groups inside it), with a place and/or an online link, and an
  optional capacity.
- **Going:** members say they're going and get a place, or the waitlist once full. Places are given one
  at a time, so the last one goes to one person. Dropping out or a larger capacity moves the longest
  waiting up, and they're told.
- **The online link** shows only to people going and those running it.
- **Changes:** a new time or place, or a cancellation, tells everyone going or waiting. Cancelled events
  stay listed, marked.
- Events you're going to or waiting for are on your calendar and iCal feed, and the bell reminds you
  within a day.

## Open groups

In kinds where members join groups themselves (communities and other organizations), a group can be
**opened** from the Groups page. Members see open groups at `/orgs/<slug>/groups` and join or leave
them; closed groups are joined only through staff.

## Related

- [Calendar](/features/communication/calendar/)
