import Link from "next/link"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/ui/components/accordion"

import { JsonLd } from "@/lib/seo/structured-data"

/*
 * The questions a college, university or coaching institute asks before trying GretLab. Every answer must
 * stay true of the code; change it with the feature it describes. Answers are plain text so
 * the same words go to search engines as FAQPage structured data; a link rides beside one.
 */

const LINK = "text-ink underline underline-offset-4 hover:text-body"

interface Question {
  q: string
  a: string
  /** Shown after the answer on the page (not in the structured data). */
  link?: { href: string; label: string }
}

const QUESTIONS: Question[] = [
  {
    q: "What is GretLab?",
    a: "An ERP for colleges, universities and coaching institutes, with a coding lab built in. Admissions, attendance, timetables, exams and grade cards, fees, parents, the hostel, transport and the library run around the lab, where students write code in the browser, a judge runs it against hidden tests, and the mark lands in the gradebook the same minute.",
  },
  { q: "Which languages can students use?", a: "Python, JavaScript, C, C++ and Java, in an editor that suggests as they type, saves as they go and follows them to any computer." },
  {
    q: "Is it safe to run students' code?",
    a: "Every run on the server happens in a throwaway gVisor container with no network, a read-only system, and limits on memory, time and processes. Hidden tests and reference solutions never go inside a student's container.",
  },
  {
    q: "Can we hold lab exams on it?",
    a: "Yes. Each student gets one timed sitting, which can be limited to your lab's network. While it runs, the rest of the site is locked to the exam, and leaving the tab or full screen, or pasting, is recorded for the teacher.",
  },
  { q: "How do you catch copied code?", a: "Similarity checks compare every submission in a class or batch, still find code whose names have been changed, and show a pair side by side. Contest organizers can also play back how each solution was written, with sudden pastes pointed out." },
  { q: "Can a problem accept more than one right answer?", a: "Yes. Numbers can be accepted within a tolerance, lines in any order, spacing and case ignored, or a teacher can write a small checker program that decides, with partial marks." },
  {
    q: "Does it handle semesters and credits?",
    a: "Yes: semesters, course credits, SGPA and CGPA on a grade card, attendance by course with a minimum to sit exams, and course and program outcome (CO–PO) attainment.",
  },
  {
    q: "How do fees work?",
    a: "Fee plans in instalments for each class, with late fines, concessions and GST where it applies. The counter takes cash, cheques or UPI with a numbered receipt, and students and parents pay online straight into your own Razorpay account: GretLab never holds the money. Reminders go out before and after the due day, and the dues report shows who's late.",
  },
  { q: "Does it work with Moodle or Canvas?", a: "GretLab supports LTI 1.3, the standard Moodle, Canvas and Blackboard use: students open it from a course, and grades go back." },
  { q: "Can students practise on their own?", a: "Yes. A public problem library with hints, editorials and a daily challenge is free with an account." },
  {
    q: "Who can see our data?",
    a: "Only your organization, and inside it only the people each role allows; it's checked on every request. Two-factor sign-in (passkeys too), college single sign-on and an activity log are built in.",
    link: { href: "/privacy", label: "Read the privacy policy" },
  },
]

/** The same questions and answers, for search engines (schema.org FAQPage). */
const faqData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: QUESTIONS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
}

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-b border-hairline px-5 py-20 lg:px-10 lg:py-24">
      <JsonLd data={faqData} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <h2 id="faq-title" className="text-display-md text-balance text-ink lg:text-display-lg">
          Questions, <span className="font-semibold">answered.</span>
        </h2>
        <Accordion className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {QUESTIONS.map(({ q, a, link }) => (
            <AccordionItem key={q} value={q} className="border-b border-hairline px-5 last:border-0">
              <AccordionTrigger className="py-4 text-left text-title-sm text-ink">{q}</AccordionTrigger>
              <AccordionContent className="pb-4 text-body-sm text-body">
                {a}
                {link && (
                  <>
                    {" "}
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                    .
                  </>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
