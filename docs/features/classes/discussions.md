---
title: Discussions
description: Threads and replies per class, anonymous to classmates if a student chooses, with votes, teacher moderation and accepted answers.
glance:
  who:
    - role: Student
      note: asks and answers
    - role: Teacher
      note: answers and moderates
  where:
    path: /orgs/<slug>/classes/<group>?tab=discussion
    menu: "A class › Discussion"
---

Each class has a Discussion tab: everyone sitting in the class or teaching it reads and posts; other
classes and outsiders get "not found".

## How it works

- **Posts are Markdown,** with code blocks; 30 posts an hour each.
- **Anonymous posts:** classmates see "Anonymous"; teachers and the author see the name. Teachers always
  post as themselves, marked Teacher.
- **Moderation:** teachers pin, lock (no more student replies), hide (only teachers and the author see
  it) and mark one reply as the answer, shown first. Authors edit and delete their own.
- **A thread with replies** is kept as "Deleted post" so the replies make sense.
- **Votes:** +1, not on your own posts. A reply tells the thread's author.

## Related

- [Class pages](/features/classes/class-pages/)
