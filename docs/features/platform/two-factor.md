---
title: Sign-in and two-factor
description: Google or email and password, then an authenticator app, codes by email or backup codes, with trusted browsers and a platform-wide requirement.
glance:
  who:
    - role: Everyone
      note: their own sign-in
    - role: Platform staff
      note: requires it, and resets lost access
  where:
    path: /account/security
    menu: "Account menu › Security"
  permissions: [platform.users.manage, platform.settings.manage]
---

## Signing in

- **Google**, or **email and password**. A new password account is confirmed by a link that needs a
  button press (so mail scanners opening it don't use it up). Passwords need at least 10 characters,
  not common, not a run, and not your email's name.
- **Forgot password** emails a one-hour, single-use link; resetting signs out every other session.
- Five wrong passwords pause password sign-in for 15 minutes (Google still works). Answers never say
  whether an address has an account.

## The second step

- **An authenticator app** (TOTP: six digits every 30 seconds) and/or **codes by email** (six digits,
  10 minutes, single use), plus **ten backup codes** that come with the first method.
- **"Don't ask again on this browser for 30 days"** trusts a browser; **Forget trusted browsers**
  undoes it everywhere.
- Five wrong codes of any kind lock the step for 15 minutes. Removing a method or making new backup
  codes needs a current code.

## Requiring it

The platform setting can require two-factor for staff, or for everyone. Someone required who hasn't
turned it on can only reach their Security page, with a banner explaining why. An admin can't require
it before turning it on themselves.

## Lost every method

Platform staff with "Manage users" turn the person's two-factor off from Dashboard › Users (not for
someone with more access, never for themselves), and the person is emailed.

## Related

- [Activity log](/features/platform/activity-log/)
