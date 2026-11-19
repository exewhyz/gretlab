---
title: Members, groups and roles
description: How people join, how groups follow the organization's own levels, and how roles given across it or within a group decide what each person can do.
glance:
  who:
    - role: Owner and admin
    - role: Office staff
      note: invites and imports
  where:
    path: /orgs/<slug>/manage/members
    menu: "People › Members, Groups, Roles, Invites"
  permissions: [org.members.view, org.members.invite, org.members.manage, org.groups.manage, org.roles.manage, org.members.import]
---

An organization is its people, arranged in **groups** and given **roles**.

## Joining

- **Open:** anyone can join.
- **Approval:** they ask, and someone with "Approve requests" decides.
- **Invite only:** only through an invite link.
- **Email domains** that join without approval, such as a college's own address.

**Invite links** can carry a role and a group, an email, a use limit and an expiry; uses are counted
exactly. People can also be added from a CSV or Excel file under **Import**, after a preview.

## Groups

Groups follow the organization's own levels (a school's Grade › Section). People sit in the **last
level**: a section, a team, a lab. Adding someone to a group with groups inside adds them to every
last-level group in it.

- The **Groups** page is built for hundreds of people per group: the tree starts folded, and a group's
  people open in a dialog, folded by the groups inside it, with search.
- People can be **moved** (taken out of a group and everything inside it, then put in the target's
  last-level groups) or **removed** from a group without leaving the organization.
- **Deleting** a group that has people is refused unless forced, and forcing moves nobody.
- People sitting directly in a group with groups inside (older data) show as **not placed yet**.

## Roles

A role is a bundle of [permissions](/reference/permissions/), given **across the organization** or
**within one group**, where it covers that group and every group inside it.

- The four [built-in roles](/reference/roles/) (Owner, Admin, Teacher, Member) can't be changed; the
  organization adds its own, starting from the suggestions for its kind.
- Permissions with finer actions show as a row to expand; a ticked parent grants and locks every action
  under it.
- **Nobody can give out a permission they don't hold**, only owners make owners, and the last owner
  can't leave.
- Roles count only while a membership is active, and are read on every request, so revoking works at
  once.

## Profiles

Everyone in an organization has a profile there (`/orgs/<slug>/profile/<id>`; your own from the
sidebar's footer, anyone's from Members). It shows:

- their roles and where they hold them, and the groups they sit in;
- for a student: their record (admission number, class, roll, year, date of birth, phone, address)
  and their parents;
- for a parent: their children;
- for staff: what they teach, the classes they're class teacher of, and their staff details:
  designation, department, staff number, start date and a work phone.

Staff fill in their own details from **Edit my details here**; the staff number is set by staff who
manage members. The person, their linked parents, and staff who may see members (for the person's
groups) see the profile; anyone else gets "not found". What a person says about themselves (a
headline, about, city, links, phone) is on their account, under **Account › Profile**.

## Step by step

### Add a role

1. **People › Roles › New role** opens a side sheet.
2. Name it, then tick its permissions: search them, or jump to an area with the chips; the count shows
   how many are chosen.
3. **Create role**, then give it to people from **Members** (each row's actions menu › **Add role**),
   across the organization or within a group.

### Invite people

1. **People › Invites › New invite**: choose the role and group it gives, and limits if you want them.
2. Share the link.

## Edge cases

- Every change to members, groups, roles, invites and settings is written to the activity log in the
  same transaction.
- Long member lists page on the server, 100 at a time.

## Related

- [Roles](/reference/roles/) and [Permissions](/reference/permissions/)
- [Student records](/features/people/student-records/)
