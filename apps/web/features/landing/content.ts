/*
 * What the landing page shows, for its two audiences: a college (a CSE batch's week in a
 * semester) and a coaching institute (a batch's week in a course). The organizations, people
 * and figures are an example and the page says so. What GretLab does is stated plainly and
 * must stay true of the code: when a feature changes, change its line here.
 */

export type Audience = "college" | "coaching"

export interface Period {
  id: string
  day: number
  /** Row in the week: 1–5 are periods; lunch sits between 3 and 4. */
  slot: number
  title: string
  status: string
  tone?: "ok" | "bad"
  /** What GretLab does in this period, in one sentence. */
  detail: string
}

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const

export const SLOTS = [
  { n: 1, time: "09:00" },
  { n: 2, time: "10:00" },
  { n: 3, time: "11:15" },
  { n: 4, time: "14:00" },
  { n: 5, time: "15:00" },
] as const

interface Week {
  label: string
  /** The class, as the grid's corner names it. */
  group: string
  /** When in the year this week sits. */
  when: string
  /** Monday to Thursday of periods 1–2 hold the headline, so they have no periods. */
  periods: Period[]
  /** The periods the "now" marker visits on load; it rests on the last. */
  tour: string[]
}

const p = (id: string, title: string, status: string, detail: string, tone?: "ok" | "bad"): Period => {
  const [d, s] = id.split("-") as [string, string]
  return { id, day: DAYS.findIndex((x) => x.toLowerCase() === d), slot: Number(s), title, status, detail, tone }
}

export const WEEKS: Record<Audience, Week> = {
  college: {
    label: "College",
    group: "CSE › Batch 2024 › A",
    when: "Semester 3 · week 9",
    periods: [
      p("fri-1", "OS register", "58 of 62 present", "Attendance is taken course by course, and each student sees how many classes they need to reach the 75% minimum."),
      p("fri-2", "Leave", "Prof. Rao · approved", "Students and faculty ask for leave; approved leave is excused on the register."),
      p("mon-3", "Lab exam", "58 of 62 accepted", "One timed sitting, optionally limited to the lab's network. Every submission is judged against hidden tests and graded the same minute.", "ok"),
      p("tue-3", "Operating Systems", "Aditya · 4 classes to 75%", "Students below the attendance minimum are flagged, with the number of classes they need.", "bad"),
      p("wed-3", "Assignment", "Due Friday · 41 of 62 in", "Coding assignments with due dates, late penalties and rubrics; marks are worked out from submissions."),
      p("thu-3", "Practice", "Daily challenge", "Problems by topic in Python, JavaScript, C, C++ and Java, with a daily challenge and streaks."),
      p("fri-3", "Peer review", "2 reviews each", "Students review classmates' code against the rubric, anonymously if the teacher chooses."),
      p("mon-4", "Mid-sem paper", "Marks by paper", "Marks are entered by paper and checked before saving, then published to the grade card."),
      p("tue-4", "Similarity check", "1 pair to review", "Submissions are compared across the class to find copied code, even with names changed."),
      p("wed-4", "DBMS", "Notes logged", "Faculty log each class against the syllabus and see which sections are behind."),
      p("thu-4", "Contest", "Inter-section · live", "Contests with ICPC or IOI scoring and a live scoreboard."),
      p("fri-4", "From Moodle", "Opened through LTI", "Students open GretLab from your LMS with LTI 1.3, and grades go back to it."),
      p("mon-5", "Outcomes", "CO3 at level 3", "Problems are tagged with course outcomes; CO and PO attainment is worked out from marks."),
      p("tue-5", "Grade card", "SGPA 8.82", "Credits, grades and points per course, with SGPA and CGPA on a printable grade card."),
      p("wed-5", "Fees", "Term 2 · 41 of 62 paid", "Fee plans in instalments, receipts at the counter, and online payment straight into your own Razorpay account, with reminders before and after the due day."),
      p("thu-5", "Early warnings", "4 students to watch", "Students with missed work, low marks, silence or low attendance are listed with the reason.", "bad"),
      p("fri-5", "Certificates", "12 issued", "Certificates for finishing a course, each with a public page anyone can check."),
    ],
    tour: ["fri-1", "tue-3", "tue-5", "thu-5", "mon-3"],
  },
  coaching: {
    label: "Coaching",
    group: "DSA in Java › Batch A",
    when: "Course week 7",
    periods: [
      p("fri-1", "Register", "38 of 42 present", "Attendance for every batch class, and parents are told the same day when their child is absent."),
      p("fri-2", "Fees", "Instalment 2 · due Monday", "Fee plans in instalments with GST on the receipt, reminders before the due day, and online payment into your own Razorpay account."),
      p("mon-3", "Weekly test", "31 of 42 accepted", "Timed tests judged against hidden tests and graded the same minute.", "ok"),
      p("tue-3", "Fee counter", "Receipt issued", "Cash, cheque or UPI at the counter, with a numbered receipt to print; concessions and scholarships come off on their own."),
      p("wed-3", "Assignment", "Due Friday · 29 of 42 in", "Coding assignments with due dates, late rules and rubrics; marks are worked out from submissions."),
      p("thu-3", "Practice", "Topic: graphs", "Problems by topic in Python, JavaScript, C, C++ and Java, with a daily challenge and streaks."),
      p("fri-3", "Parents", "Marks and dues", "Parents follow attendance, marks, the timetable and fees on their phone, and can pay online."),
      p("mon-4", "Contest", "Batch against batch", "Contests with ICPC or IOI scoring and a live scoreboard."),
      p("tue-4", "Similarity check", "1 pair to review", "Submissions are compared across the batch to find copied code, even with names changed."),
      p("wed-4", "Doubts", "6 threads", "Each batch has its own discussion, with answers marked by faculty."),
      p("thu-4", "Early warnings", "3 students to watch", "Students with missed work, low marks, silence or low attendance are listed with the reason.", "bad"),
      p("fri-4", "Timetable", "Batch B at 6 pm", "Timetables per batch; a teacher can't be booked in two batches at once."),
      p("mon-5", "Results", "Rank 4 of 42", "Marks by test, with ranks and a printable report card."),
      p("tue-5", "Admissions", "5 new enquiries", "Applications online, reviewed and admitted into a batch, with the parent linked."),
      p("wed-5", "Dues", "8 students overdue", "Who owes and who's late, by batch, with a CSV for the accounts.", "bad"),
      p("thu-5", "Leave", "Riya · 2 days", "Students and faculty ask for leave; approved leave is excused on the register."),
      p("fri-5", "Certificates", "Course completed", "Certificates for finishing a course, each with a public page anyone can check."),
    ],
    tour: ["fri-1", "fri-2", "tue-3", "wed-5", "mon-3"],
  },
}

/** The coding lab: one submission, followed to the gradebook and on to a guardian or mentor. */
export const LAB = {
  code: [
    "nums = input().split()",
    "best = sorted(set(map(int, nums)))",
    "print(best[-2] if len(best) > 1 else None)",
  ],
  tests: 12,
  ms: 48,
  gradebook: [
    { name: "Diya Patel", mark: "50 / 50" },
    { name: "Aarav Sharma", mark: "48 / 50", me: true },
    { name: "Kabir Rao", mark: "39 / 50" },
    { name: "Meera Nair", mark: "Not started" },
  ],
  /** One short line under each step of the chain. */
  captions: [
    "Five languages, in an editor that saves as they type.",
    "A throwaway sandbox with no network, and tests nobody sees.",
    "Marks come from submissions, never typed by hand.",
    "Released when the teacher chooses.",
  ],
}

/** What sits around the lab, for each audience: six short lines. */
export const AROUND: Record<Audience, { title: string; items: [string, string][] }> = {
  college: {
    title: "For a college",
    items: [
      ["Attendance by course", "with the 75% minimum built in"],
      ["Semesters and credits", "SGPA, CGPA and grade cards"],
      ["Outcomes", "CO and PO attainment from marks"],
      ["Lab exams", "one sitting, the lab's network if you like"],
      ["Fees and receipts", "online into your own Razorpay account"],
      ["Your LMS", "LTI 1.3, with grades sent back"],
    ],
  },
  coaching: {
    title: "For a coaching institute",
    items: [
      ["Batches and timetables", "nobody booked twice at once"],
      ["Fees with GST", "instalments, receipts, online payment"],
      ["Tests and ranks", "graded the same minute"],
      ["Parents", "attendance, marks and dues on their phone"],
      ["Admissions", "applications to a batch, parent linked"],
      ["Dues", "who owes and who's late, by batch"],
    ],
  },
}

/** Under the hood, as short as it can be. */
export const TRUST = [
  "Permissions by group",
  "Each organization kept apart",
  "Two-factor sign-in",
  "An activity log of every change",
  "PDF grade cards and certificates",
]
