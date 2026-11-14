---
title: Lab exams
description: One timed sitting per student, a start window, limits to the lab's network, and the whole site locked to the exam while it runs.
glance:
  who:
    - role: Teacher
      note: sets the exam and watches sittings
    - role: Student
      note: sits it once
  where:
    path: /orgs/<slug>/manage/assignments
    menu: "Coding lab › Assignments › an assignment's exam settings"
  permissions: [assignments.manage, assignments.extend, gradebook.view]
  module: coding
---

A lab exam is an assignment with exam settings: each student gets **one sitting**, timed from when
they start, and while it runs the site is locked to the exam.

## How it works

- **One sitting.** Starting fixes its end: the time limit or the due time, whichever comes first.
  Starting again returns to the same sitting; once it's over there's no second one. Exams take no late
  work.
- **Start window.** Optionally, starting is allowed only in the first minutes after opening, so a lab
  starts together.
- **The database's clock** times every sitting, the same clock submissions are stamped with. Work
  stamped up to 10 seconds after the end still counts (a last-second press).
- **Only work from the sitting counts,** including hand marks.

## The site locks to the exam

While a student's sitting runs:

- Runs and submissions only work on the exam's problems, from the lab's networks: no playground, no
  other problems, no contests.
- No editorials, notes, or earlier submissions and drafts from before the sitting.
- Any page outside the exam sends them back to it; the header becomes the exam and its clock.
- Leaving the tab or window, leaving fullscreen, and pasting text not copied on the page are recorded.
  Outside fullscreen, a cover blocks everything else.

These records are for the teacher to read, not proof of anything.

## Limiting it to the lab's network

Networks are IPv4 or IPv6 addresses or CIDR ranges. Starting, submitting and saving drafts need an
address inside them. The address is only ever taken from something a visitor can't forge, so a
deployment needs one setting: see [Lab exams on your deployment](/deploy-exams/). Without it, a
network-limited exam can't be saved, and the form says why.

## Step by step

1. Create an assignment and turn on **exam** settings: the time limit, an optional start window and
   the lab's networks. **Your address right now** shows what to compare against.
2. Students start from the assignment page; their problems appear once they do.
3. In the gradebook, each student's sitting, warning count and events are listed. **More time**
   reopens a finished sitting and keeps their work.
4. After the exam, **Forget addresses** deletes the stored network addresses.

## Edge cases

- Once anyone has started, the exam can't stop being an exam or change its problems; time, due time,
  networks, points and rubrics still can.
- If a runner fails, the submission is judged again automatically; the gradebook's **Re-judge system
  errors** re-queues an assignment's after a longer outage.
- Library problems are public: for a closed exam, write or import the exam's own problems.

## Related

- [Lab exams on your deployment](/deploy-exams/)
- [Assignments and the gradebook](/features/coding/assignments/)
