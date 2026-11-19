---
title: Run and Submit
description: Trying code on the samples versus grading it on every test, and why only a graded submission is ever "Accepted".
glance:
  who:
    - role: Anyone signed in
      note: runs and submits
  where:
    path: /problems/<problem>
    menu: "A problem's editor › Run / Submit"
  module: coding
---

GretLab keeps two buttons, the same model as LeetCode and HackerRank, and keeps them distinct
everywhere.

## How it works

**Run** tries your code on the cases in the panel: the samples plus any input you add.

- Nothing is graded, and nothing is added to your submissions.
- An input that matches a sample is compared with that sample's output, which the server looks up.
- Any other input has nothing to compare with, so it ends as **Finished**.
- A Run can't probe hidden tests.

**Submit** grades your code against every test, hidden ones included, and records it in your history.

## "Accepted" means graded

Only a graded submission that passed everything is ever shown as **Accepted**. A Run whose samples all
match is shown as **Sample cases passed**, never as Accepted, so the app never claims a problem is
solved when it isn't.

## Verdicts

The labels below are the app's own (`packages/judge/src/verdicts.ts`).

| Verdict | Meaning |
| --- | --- |
| Accepted | A submission passed every test (Submit only) |
| Sample cases passed | A Run whose sample cases all matched (never called Accepted) |
| Finished | A Run on your own input, with nothing to compare against |
| Wrong answer | Output differed from the expected output on a test |
| Time limit exceeded | A test ran longer than its limit |
| Memory limit exceeded | A test used more memory than allowed |
| Output limit exceeded | The program printed more than allowed |
| Runtime error | The program crashed |
| Compilation error | The code didn't compile |
| System error | The judge failed, not your code; graded work is retried automatically |

## Hidden tests

For hidden tests, students see the verdict and timing only, never the input, output or expected output.
Staff see everything. The expected output never enters the sandbox: the runner compares outside it.

## Where code runs

Three levels decide, each only narrowing the one above:

1. **The platform** (Dashboard › Settings › Execution): server execution, running in the browser, and
   **Grade in the browser** (off by default).
2. **An organization** (Manage › Settings › Code execution), for its own assignments, contests and
   members-only problems: it can turn server execution off for its work, and allow grading in the
   browser if the platform does. It can't turn on what the platform has off.
3. **An assignment or contest**: **On the server** (every language) or **In the students' browsers**
   (Python and JavaScript only). Its form also takes a **submission limit per minute**, which can be
   lower than the platform's but never higher.

When code can't run on the server, Python and JavaScript run in the student's browser and only those
two languages are offered. Submit then works only where grading in the browser is allowed:

- the server sends every test's **input** to the browser, never an expected output;
- the browser runs them and sends the outputs back, and the server compares them;
- the result is marked **Provisional**. Once server execution is back for that work, the runners
  judge the same code again and their verdict replaces it.

Without it, Submit is paused until the server is back. Grading in the browser is used for library
practice while server execution is off, and for an organization's work when the organization turns it
on. Hidden tests' inputs reach the student's browser in that mode, so use it when the judge is failing
rather than for exams that must stay closed.

## Edge cases

- A **System error** on graded work is judged again by the runners after two minutes, up to three
  rounds, keeping its original submit time, so in-time exam work still counts.
- During a [lab exam](/features/coding/lab-exams/), runs and submissions are limited to the exam's
  problems and the lab's network.
- With server execution switched off, signed-in students run Python and JavaScript in the browser.
  Submit is paused unless grading in the browser is allowed (see [Where code runs](#where-code-runs)).

## Related

- [Problems and practice](/features/coding/problems-and-practice/)
- [Scaling and operations](/scaling/): how the queue and runners work
