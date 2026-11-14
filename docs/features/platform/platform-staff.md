---
title: Platform staff and organizations
description: The people who run the site, their roles, the organizations they create and the kinds' module policy, and how staff reach inside an organization.
glance:
  who:
    - role: Platform owner
    - role: Organizations manager
    - role: Support
  where:
    path: /admin
    menu: "Dashboard"
  permissions: [platform.roles.manage, platform.orgs.manage, platform.orgs.act, platform.orgs.view, platform.kinds.manage]
---

## Staff and roles

The Dashboard is run by staff with platform roles: built-in ones (Owner, Content admin, Content editor,
Reviewer, Support, Organizations manager, Communications, Auditor) and custom ones. See
[Roles](/reference/roles/).

- People in `ADMIN_EMAILS` are always owners and can't be removed in the app.
- Nobody gives or makes a role with permissions they don't hold; only owners make owners; the platform
  keeps at least one.
- Every platform change goes in the platform's [activity log](/features/platform/activity-log/).

## Organizations

- **Created** by platform staff (choosing the kind and first owner), or registered by a school at
  `/schools/new` when the platform allows it: off, with review, or open.
- **Kinds' modules:** Dashboard › Organization kinds sets, per kind, whether each module it can use is
  off, optional or on from the start, for every organization of that kind at once, and each kind's
  suggested roles.

## Reaching inside an organization

Two platform permissions reach every organization, joined or not:

- **Act in organizations:** everything an organization's admin can do, logged as support.
- **See inside organizations:** read-only.

Personal things stay personal: someone's own leave, check-in, library loans and class seat need a
membership.

## Related

- [Kinds and modules](/reference/kinds-and-modules/)
