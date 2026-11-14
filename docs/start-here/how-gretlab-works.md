---
title: How Gretlab works
description: Accounts and organizations, groups and roles, modules, the switcher, and what happens when someone runs code.
---

## One account, several organizations

Everyone has one personal account. Signing in uses Google, or an email address and password, followed
by a second step if [two-factor sign-in](/start-here/glossary/#two-factor) is on.

An account joins **organizations**: a school, a college, a company, a club. Each organization is its
own world, with its own members, groups, roles, invite links and settings. Nothing in one organization
is visible from another, and every query on an organization's data is scoped to it.

An account that belongs to no organization still has the coding lab: the public problem library,
practice, the daily challenge, contests and the leaderboard.

## The life of an organization

1. **Created.** The platform creates it and names its first owner, or someone registers a school at
   `/schools/new` (when the platform allows it, possibly after review).
2. **Given a kind.** School, college, coaching institute, cohort program, company, community or other,
   chosen once and never changed. The kind decides its words, group levels, grading and the modules it
   can use. See [Kinds of organization](/start-here/kinds-of-organization/).
3. **Shaped.** Groups in its own levels (Grade › Section, Department › Batch, Cohort › Pod), roles, and
   modules switched on or off in Settings › Modules.
4. **Filled.** People join by invite link, by email domain, by request, by CSV import or through
   admissions; students get records and a class for the year.
5. **Run.** Registers, timetables, leave, work and exams, every day.
6. **Followed up.** Reports, early warnings, outcomes and the activity log.

## Groups and roles

**Groups** are the organization's structure, named by its levels. People sit in the last level (a
section, a team, a lab), and being in a section is what puts someone in its year or department.

**Roles** are bundles of [permissions](/reference/permissions/). A role is given across the whole
organization, or within one group, where it covers that group and every group inside it. A class
teacher's Teacher role, given on "Grade 6 › A", lets them take that section's register and grade its
work, and nothing else.

Roles are read from the database on every request, never trusted from the session, so taking one away
works at once. Nobody can give out a permission they don't hold.

## Modules

What an organization can switch on is decided in three layers:

1. **The kind** says which modules are possible at all (a company has no hostel).
2. **The platform** decides per kind whether each possible module is off, optional or on from the start.
3. **The organization** switches the optional ones in Settings › Modules.

A module that's off leaves no trace: its pages, menu items and API answer as if it didn't exist.

## Content that reaches people

Assignments, contests and notices are aimed at an **audience**: groups, combined. "3rd Year and CAC"
means third-year students taking CAC, in every section. Whoever is in the audience can take part;
anyone else gets "not found", not "not allowed".

## The switcher

The header's organization switcher chooses whose content the lists show: everything, personal (the
platform's own), one organization or a mix. Problems, assignments, contests, classes, teaching, the
home page and the leaderboard follow it. It only narrows what you see; access is always decided on the
server.

## Running code

When a student presses **Run** or **Submit**, the code is queued in Postgres. A runner machine claims
the job, compiles and runs it in a throwaway gVisor container with no network, a read-only file system
and limits on memory, time, processes and file size, and records the verdict. Hidden tests' expected
output never enters the sandbox: the runner compares outside it. See
[Run and Submit](/features/coding/run-and-submit/) and [Scaling and operations](/scaling/).
