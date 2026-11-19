---
title: Profiles
description: Your account's profile, and who someone is in each organization, with their roles, classes, a student's record and parents, a parent's children and a teacher's details, each shown only to those allowed to see it.
glance:
  who:
    - role: Everyone
      note: their own profile
    - role: Staff
      note: see members' profiles
    - role: Parent
      note: sees their child's
  where:
    path: /orgs/<slug>/profile/<person>
    menu: "Members › a name, or the sidebar's footer"
  permissions: [org.members.view, org.members.manage, students.view, parents.view]
---

There are two kinds of profile: what you say about yourself on your account, and who you are in
each organization you belong to.

## Your account

**Account › Profile** (the account menu, or `/account`) holds your name, your profile address
(`/u/<handle>`), a headline, a few words about you, your city, links (a website, GitHub and
LinkedIn) and a phone number. A checklist beside the form shows what's still missing. The phone
is stored encrypted.

**Account › Security** is the tab beside it, for your password and two-factor sign-in.

## In an organization

Your profile there opens from the sidebar's footer; anyone's opens from **Members**. It shows:

- **Here:** their roles and where they hold them, and the groups they sit in.
- **Student record**, for a student: admission number, class, roll number, year, gender, date of
  birth, phone, address and when they were admitted. The office keeps the record; students ask it
  to correct anything.
- **Parents**, for a student, and **Children**, for a parent.
- **Teaching:** the subjects and classes they teach, the classes they're class teacher of, and the
  groups they lead.
- **Staff details:** designation, department, staff number, the date they joined the staff and a
  work phone.
- **About:** what they wrote on their account.

## Who sees what

| Who | Sees |
| --- | --- |
| The person | Their whole profile |
| Their linked parents | Their child's whole profile |
| Staff who may see members, records or parents for the person's groups | Their profile, with contact details and the record |
| Platform staff who look inside organizations | The same, read-only |
| Anyone else | "Not found" |

## Who edits what

- Staff fill in their own designation, department, start date and work phone from **Edit my
  details here**.
- Their **staff number** is set by staff who manage members, from the same dialog on their profile.
  Those changes go in the organization's activity log.
- A student's record is changed under **People › Students**, not here.

## Related

- [Members, groups and roles](/features/people/members-groups-roles/)
- [Student records](/features/people/student-records/)
- [Parent accounts](/features/people/parent-accounts/)
