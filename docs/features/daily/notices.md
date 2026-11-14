---
title: Notices
description: Notices for the whole organization or one class, on the organization's page and the class stream.
glance:
  who:
    - role: Owner and admin
      note: notices for everyone
    - role: Class teacher
      note: notices for their class
    - role: Members and parents
      note: read them
  where:
    path: /orgs/<slug>/manage/notes
    menu: "Every day › Notices"
  permissions: [notices.manage, notices.create, notices.delete]
---

Notices are short messages members see on the organization's page, and class notices on the class's
stream.

## How it works

- **For everyone:** needs organization-wide "Post notices".
- **For a class:** a class teacher posts from the class page, and can remove only notices for groups
  they cover.
- Members are told about class notices for their classes, and parents get a copy for their children.
- Organization notices never appear on public pages.

## Related

- [Notifications and email](/features/communication/notifications/)
- [Class pages](/features/classes/class-pages/)
