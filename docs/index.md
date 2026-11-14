---
title: Gretlab documentation
description: Guides for the people who run Gretlab and connect it to other systems.
template: splash
hero:
  tagline: How to fill Gretlab with your problems and questions, connect your other systems, and run it for a class or a whole college.
  actions:
    - text: Import problems
      link: /problem-format/
      icon: right-arrow
    - text: The organization API
      link: /api/
      variant: minimal
---

<!-- The documentation site's home page (apps/docs). Every guide in this folder is a page there. -->

## Content

- **[Problem file format](/problem-format/)**: import coding problems into the library, or straight into an assignment, exam or contest.
- **[Question file format](/question-format/)**: import quiz questions into the question bank, with choices, accepted answers and explanations.

## Integrations

- **[The organization API](/api/)**: keys for another system to call an organization's API, the endpoints to start with, and signed webhooks.

## Running Gretlab

- **[Lab exams on your deployment](/deploy-exams/)**: limit an exam to the lab's network on Vercel, behind Caddy or on another host.
- **[Scaling and operations](/scaling/)**: the architecture, what was measured, and how to size web replicas and runner machines.
