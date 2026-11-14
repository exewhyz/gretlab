---
title: Problem file format
description: The JSON file that imports problems into the library and into assignments, exams and contests.
---

One JSON format imports problems everywhere: the problem library (Dashboard › Problems › Import), and the problem picker of the assignment, exam and contest forms ("Import problems"). A template to copy is served at `/problem-template.json`.

```json
{
  "format": "gretlab-problems",
  "version": 1,
  "problems": [ { ...one problem... }, { ... } ]
}
```

A bare list of problems, or a single problem object, is accepted too. At most 100 problems per file and 8 MB per upload. Every problem is checked before any is saved: one mistake and nothing is imported, with the problem number, title and field named.

## A problem

| Field | Required | What it is |
| --- | --- | --- |
| `title` | yes | Shown to students. |
| `slug` | no | The address (`/problems/<slug>`). Made from the title; a number is added if it's taken. |
| `level` | no | `easy` (default), `medium` or `hard`. |
| `statement` | yes | The problem in Markdown: GitHub tables, lists, code blocks. Raw HTML is shown as text. Images: upload them in the editor after importing. |
| `input`, `output`, `constraints` | no | Input format, output format and constraints, shown under their own headings. A list of lines, or one string with a line each. Keep them out of the statement. |
| `samples` | yes, one or more | `{ "input": "...", "output": "...", "points": 1 }`. Shown to students as examples, and graded. |
| `tests` | no | Hidden tests, same shape. Students see only pass/fail and timing. |
| `code` | no | Per language (`python`, `javascript`, `c`, `cpp`, `java`): `{ "starter": "...", "solution": "..." }`. The starter is exactly what a student's editor opens with; the solution is shown under the editorial's rules and is never sent to students otherwise. |
| `hints` | no | Up to 10, Markdown, revealed one at a time. |
| `editorial` | no | Markdown, unlocked by the practice rules. |
| `tags` | no | Up to 10 names. |
| `timeLimitMs`, `memoryLimitMb` | no | `null` for the defaults. |
| `languages` | no | Languages students may use, e.g. `["python", "cpp"]`; `null` for all. |

Outputs are compared the same way as in the editor: trailing spaces and the final newline don't matter.

## Where imported problems go

- **Problem library import:** choose whether they're published, and whether they show in the library.
- **From an assignment, exam or contest form:** they're ready for students but **not in the library**. Students reach them only through the work that uses them: an assignment once it opens, an exam once they start it, a contest once it starts. Use this for exams so nobody can practise the problems beforehand.
