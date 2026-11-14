---
title: Question file format
description: The JSON file that imports quiz questions into the question bank and into assignments, exams and contests.
---

One JSON format imports quiz questions everywhere: the question bank (Dashboard › Questions › Import) and the question picker in the assignment, exam and contest forms ("Import questions"). A template to copy is served at `/question-template.json`. Imported questions go into the bank, so they can be reused.

```json
{
  "format": "gretlab-questions",
  "version": 1,
  "questions": [ { ...one question... } ]
}
```

A bare list of questions is accepted too. At most 500 per file. Every question is checked before any is saved; one mistake and nothing is imported, with the question number and field named.

## A question

| Field | Required | What it is |
| --- | --- | --- |
| `kind` | yes | `single` (one right option), `multiple` (several), `short` (a word or phrase), `written` (sentences, marked by a teacher). |
| `question` | yes | The question in Markdown. |
| `title` | no | A short name for lists; made from the question if missing. |
| `options` | choice | The options' texts, in order. They're lettered A, B, C… |
| `answer` | choice | The right option(s): letters (`"B"`, `["A", "C"]`) or option texts. For `short`, one more accepted answer. |
| `accepted` | no | `short` only: answers that mark themselves right. Case, extra spaces and a final full stop don't matter. Without any, a teacher marks every answer. |
| `explanation` | no | Markdown, shown with the right answer once results are out. |
| `points` | no | Suggested points (default 1); each assignment or contest can set its own. |
| `tags` | no | For finding questions in the bank. |

Contests and the daily challenge use only questions that mark themselves: choice questions, and short answers with accepted answers.
