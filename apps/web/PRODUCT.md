# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Every role is a first-class user; no single audience outranks another. Each works in their own organization and sees only what their roles open.

- **People who run an organization:** owners, principals, deans, centre heads, office staff, exam cells, librarians, L&D admins, compliance officers and community organisers. Their daily work is people, groups, attendance, exams and marks, leave, admissions, the library, transport, the hostel, training, events and reports. It is data-heavy and mostly done on a laptop.
- **People who teach or lead a group:** teachers, faculty, mentors, managers and moderators. They take registers, log classes, set and grade work, post notices, and follow their students.
- **Members:** students, learners, employees and community members. They check their week, work due, results, attendance, training and events, often on a phone.
- **Parents (guardians):** follow each child's attendance, timetable, marks, bus, library and notices, and ask for leave, mostly on a phone.
- **Coding learners:** anyone signed in. They practise problems in the browser editor, run and submit code to the judge, and take assignments, contests and the daily challenge.
- **Platform staff:** owners and staff roles (Support, Organizations manager, Content admin and editor, Reviewer, Auditor, Communications). They run the site, its content library and its organizations.

## Product Purpose

Gretlab is one place where any kind of learning organization runs its day and its people learn, with a coding lab built in. Success means:

- each role finds today's work on its home and finishes it in a few clicks;
- every number shown leads to the detail behind it;
- no link leads to a page the person can't use.

## Positioning

One platform for every kind of organization: school, college, coaching institute, cohort program, company, community and other.

- Each kind gets its own words (students, learners, employees), group levels, roles and modules from a single kinds registry.
- Each organization switches modules on and off.
- The same product also carries a real code-execution judge (sandboxed runners), so coding practice, assignments, lab exams and contests live beside attendance, records and report cards.

## Operating Context

- **Daily rhythms:** registers each morning or each period, timetables, notices, and leave requests and decisions.
- **Exam cycles:** marks entry by paper, report cards and promotion.
- **Admissions** each year.
- **Training** with due and renewal dates.
- **Cohort runs:** weeks and graduation.
- **Events** with RSVPs and waitlists.
- **Documents:** CSV imports and exports, PDF report cards, transfer certificates and ID cards, an iCal feed, LTI 1.3 links from other LMSs, and email notifications.
- **Devices:** staff mostly use laptops; parents and students often use phones.
- **Usage:** Indian institutions are the first users (academic years, grades and sections, INR). Demo data covers six organizations of different kinds plus platform staff.

## Capabilities and Constraints

- **Stack:** Next.js 16 app (`apps/web`); shared UI in `packages/ui` (shadcn base-vega on Base UI, Phosphor icons); TanStack Query; Drizzle on Postgres; Zod.
- **Permissions:** access is per permission and per group (a class teacher sees their class). The sidebar (`ORG_NAV`), home cards and APIs follow one rule, and a link appears only where its page opens.
- **Modules:** switched per organization within the kind's policy. A switched-off module leaves no trace in the UI.
- **Wording:** follows the kind's terms everywhere.
- **Undecided or on hold:** fees and payments, the public landing page, and Google's sign-in strength in two-factor.

## Brand Commitments

- The name is Gretlab (GretLab in the header mark).
- Primary colour #f54e00 (orange). The existing component library and type are kept.
- UI work improves clarity, layout, navigation and data presentation within this look; it does not replace the visual identity.
- Voice: plain, short, specific sentences that say what happens ("Registers to take", "Nothing due. Enjoy it.").

## Evidence on Hand

- **Demo data:** `packages/db/src/demo/`, with six demo organizations and about 32 role accounts (password in `packages/db/src/demo/shared.ts`).
- **Tests:** end-to-end suites in `e2e/` (about 2,400 checks) with screenshots.
- **Not available:** real customer names, testimonials or usage figures. Don't invent them.

## Product Principles

1. **Today first:** every home leads with what this person must do now, then what's coming, then the rest.
2. **Every number is a door:** a count, rate or chart links to the rows behind it, but only if the person can open them.
3. **The kind's words, the person's reach:** labels, groups and modules match the organization's kind and the viewer's roles. Nothing appears that they can't use.
4. **Dense but calm:** staff screens show a lot of data with clear hierarchy, aligned numbers and strong empty states, without decoration.
5. **Works on a phone:** member and parent screens are designed for phone width first.

## Accessibility & Inclusion

- Pages must be fully usable by keyboard.
- Headings and labels are meaningful; tests find elements by role and label.
- Light and dark themes are both supported.
- Text must stay readable at phone width with no horizontal scroll.
