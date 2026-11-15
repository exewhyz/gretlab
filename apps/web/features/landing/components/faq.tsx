import Link from "next/link"
import type { ReactNode } from "react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/ui/components/accordion"

/*
 * The questions a college or cohort program asks before trying GretLab. Every answer must
 * stay true of the code; change it with the feature it describes.
 */

const LINK = "text-ink underline underline-offset-4 hover:text-body"

const QUESTIONS: [string, ReactNode][] = [
  [
    "What is GretLab?",
    "A coding lab for colleges and cohort programs. Students write code in the browser, a judge runs it against hidden tests, and the mark lands in the gradebook the same minute. Attendance, semesters and cohort runs live around it.",
  ],
  ["Which languages can students use?", "Python, JavaScript, C, C++ and Java, in an editor that saves as they type and follows them to any computer."],
  [
    "Is it safe to run students' code?",
    "Every run on the server happens in a throwaway gVisor container with no network, a read-only system, and limits on memory, time and processes. Hidden tests and reference solutions never go inside it.",
  ],
  [
    "Can we hold lab exams on it?",
    "Yes. Each student gets one timed sitting, which can be limited to your lab's network. While it runs, the rest of the site is locked to the exam, and leaving the tab or full screen, or pasting, is recorded for the teacher.",
  ],
  ["How do you catch copied code?", "Similarity checks compare every submission in a class or cohort and still find code whose names have been changed."],
  [
    "Does it handle semesters and credits?",
    "Yes: semesters, course credits, SGPA and CGPA on a grade card, attendance by course with a minimum to sit exams, and course and program outcome (CO–PO) attainment.",
  ],
  [
    "How do cohorts work?",
    "A cohort has run dates and pods, each with a mentor. Mentors and program managers see every learner's work, attendance and warnings by week, and graduates get a certificate anyone can check.",
  ],
  ["Does it work with Moodle or Canvas?", "GretLab supports LTI 1.3, the standard Moodle, Canvas and Blackboard use: students open it from a course, and grades go back."],
  ["Can students practise on their own?", "Yes. A public problem library with hints, editorials and a daily challenge is free with an account."],
  [
    "Who can see our data?",
    <>
      Only your organization, and inside it only the people each role allows; it's checked on every
      request. Two-factor sign-in and an activity log are built in. The{" "}
      <Link href="/privacy" className={LINK}>
        privacy policy
      </Link>{" "}
      has the details.
    </>,
  ],
]

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-b border-hairline px-5 py-20 lg:px-10 lg:py-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <h2 id="faq-title" className="text-display-md text-balance text-ink lg:text-display-lg">
          Questions, <span className="font-semibold">answered.</span>
        </h2>
        <Accordion className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {QUESTIONS.map(([q, a]) => (
            <AccordionItem key={q} value={q} className="border-b border-hairline px-5 last:border-0">
              <AccordionTrigger className="py-4 text-left text-title-sm text-ink">{q}</AccordionTrigger>
              <AccordionContent className="pb-4 text-body-sm text-body">{a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
