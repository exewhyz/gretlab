---
title: Activity log
description: Who changed what, when and from where, for each organization and for the platform, with filters, details and CSV.
glance:
  who:
    - role: Owner and admin
      note: their organization's log
    - role: Auditor
      note: the platform's log
  where:
    path: /orgs/<slug>/manage/activity
    menu: "School › Activity; Dashboard › Activity"
  permissions: [org.audit.view, platform.audit.view]
  demo:
    as: the platform auditor
    email: auditor@platform.demo.invalid
    path: /admin
---

## What an entry records

- **Who:** the person, and their name and email as they were then, so it still reads correctly after
  the account is deleted. Changes made through an API key name the key.
- **What:** the action (such as `role.update`) and its area, a sentence, and for edits that change
  several things, each field and list from what to what, in words.
- **Where from:** the address (only when it can be trusted) and the browser.
- **Support:** marked when platform staff acted inside an organization they aren't a member of.

Every change to members, groups, roles, invites and settings is written in the same transaction as the
change itself.

## Reading it

Filter by area, person, words and dates; open an entry for its details; download up to 10,000 entries
as CSV (the download is logged too). Formula-looking fields are made safe for spreadsheets.

## Related

- [Members, groups and roles](/features/people/members-groups-roles/)
