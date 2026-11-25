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

### An organization requiring it

An organization can require two-factor sign-in of its own people under **Manage › Settings ›
Two-factor sign-in**: of its staff (anyone holding a role there) or of everyone. It only adds to
what the platform requires, never relaxes it, and someone who doesn't use two-factor themselves
can't turn it on (so they can't lock themselves out). The change is in the organization's
activity log. People it applies to who haven't turned two-factor on can only reach their security
page until they do; people outside the organization aren't affected.

## Confirming changes that matter

With two-factor on, some changes ask for a fresh code when your last one is more than 10 minutes
old: changing roles and permissions, overriding quiz marks, giving extensions or exam time,
organization, LMS and platform settings, API keys and webhooks, plans and prices, and deleting
problems, questions, assignments, contests, courses, templates, units or exams.

A dialog asks for a code from your authenticator app, an emailed code, or a backup code; then the
change goes ahead without starting over. Closing the dialog leaves it undone. A browser you trust
for 30 days still asks: trusting skips the code at sign-in only. Each confirmation is in the
activity log. Without two-factor nothing is asked; the platform can require two-factor for staff.

## Lost every method

Platform staff with "Manage users" turn the person's two-factor off from Dashboard › Users (not for
someone with more access, never for themselves), and the person is emailed.

## Related

- [Activity log](/features/platform/activity-log/)
