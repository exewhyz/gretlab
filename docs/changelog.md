---
title: Changelog
description: What's new in GretLab, newest first.
---

What changed for the people using GretLab, newest first. Fixes and changes that don't show to anyone
aren't listed.

## 15 November 2026

### A landing page

- Visitors to the site now land on a page for colleges and cohort programs: the coding lab that
  grades itself, shown inside a week you can switch between a college's semester and a cohort's
  run. Each period shows what GretLab does in it, from lab exams and grade cards to mentors,
  GitHub projects and graduation.
- Its main button follows your settings: **Register your college** when sign-up is open, otherwise
  **Talk to us**, a short contact form on the page.
- **Enquiries** from that form are listed on **Dashboard › Landing page** to follow up and mark
  handled, and emailed to the contact email for organizations (Dashboard › Settings › Landing page).
- **Questions, answered:** an FAQ on the page.
- **Partners and testimonials:** add real institutions and quotes on Dashboard › Landing page; each
  section appears only once it has some.
- Signed-in people still go straight to their home.

### Fixes

- The **d** shortcut for light and dark no longer fires while you type in the code editor or a
  field, or choose from a menu or list. It still works anywhere else on the page.

### Readable problem addresses and topic pages

- Problems have addresses made from their titles: `/problems/integer-operations` instead of
  `/problems/p2`. Old addresses keep working: they send people, links and search engines to the new
  ones, and the API still accepts them. Progress saved in a visitor's browser moves with them.
- If a problem's address is changed, the old one keeps leading to it, and no other problem can take it.
- **Topic pages:** every tag has a page listing its problems easiest first, at
  `/problems/topics/<tag>`, and `/problems/topics` lists them all. **Browse by topic** in the library,
  and a problem's tags, lead there.

### Privacy policy and terms of use

- New [privacy policy](https://gretlab.grettech.com/privacy) and
  [terms of use](https://gretlab.grettech.com/terms), in plain language.
- Who runs the site, its contact email, grievance officer, postal address and governing law are set in
  **Dashboard › Settings › Legal**.
- Sign-in and sign-up say that continuing accepts both; every sign-in page links them.

### Search engines, a new logo and the name GretLab

- The site's address, description, tagline, indexing and Google and Bing verification codes are set in
  **Dashboard › Settings › Search engines** (see
  [Site settings, search and legal](/features/platform/site-settings/)).
- Public pages have their own titles, descriptions and canonical addresses; there's a sitemap,
  `robots.txt`, and structured data for search results.
- Links shared on WhatsApp, Slack, LinkedIn or X show a card: one for the site, one for each problem.
- A new logo: code braces holding a check, for code that's been judged and graded. It's the site's icon,
  the phone home-screen icon and the logo on share cards.
- The name is written GretLab everywhere.

### Documentation

- This documentation site: every feature role by role, setup and operations, and reference tables
  read from the app itself.

## 14 November 2026

- **The organization switcher** now also narrows the leaderboard and your home to the organizations
  you choose. The leaderboard never names anyone's organization.
- **Names sort the way people read them:** Grade 6 before Grade 10.
- **Layouts:** wide tables scroll in their own box instead of hiding columns on phones; editors and
  details open in side panels.
- **Long lists** (members, parent links, organizations, report tables) load a page at a time, with
  search.
- **Days off:** no registers, lessons or check-in are expected on days that aren't school days.
- **Holidays** for each organization, and a **calendar of everything dated** (exam papers, leave,
  training, cohort runs, holidays).
- **The coding lab is a module** an organization can switch off.
- **Sidebar groups fold**, and remember it.
- **Integrations:** organization API keys and signed webhooks. See [the organization API](/api/).
- **Leaderboard:** your rank in the summary and your row marked.
- **Links only lead where you can go;** a page you can't open says so instead of loading forever.
- **Platform staff** can act inside, or only look inside, any organization, recorded in its activity
  log.
- **Errors** show a short reference you can quote to support.

## 13 November 2026

- **Kinds of organization** (school, college, coaching institute, cohort program, company, community,
  other), each with its own words, group levels, role names and modules, chosen once at creation.
- **Suggested roles** for each kind, offered on the Roles page.
- **Colleges:** semesters, course credits, SGPA and CGPA on a grade card; course-wise attendance with
  the minimum to sit exams.
- **Cohort programs:** run dates, a mentor per pod, learner progress and graduation certificates.
- **Companies:** assigned training with due dates and renewal, and expiring certificates.
- **Communities:** open groups members join themselves, and events with places and a waitlist.
- **Email and password sign-in** beside Google, with confirmation and password reset.
- **Email templates:** every email is branded, has a plain-text copy, and can be edited from
  **Dashboard › Emails**.
- **A home for members:** your schools, work due, contests and practice in one place.
- **Admin and staff dashboards** share one frame with the organization pages.

## 12 November 2026

- **School modules:** attendance registers, subjects, timetables (with teacher clashes caught), parent
  accounts, library loans, transport routes and hostel beds.
- **Student records:** academic years, admission numbers, enrolments, promotion to the next year and
  importing students.
- **Exams and report cards:** papers per subject and class, marks entry, results and ranks,
  publishing, remarks and a comment bank, printable report cards.
- **Leave** for students, parents and staff, decided by class teachers and the office; approved leave
  excuses absences.
- **Staff attendance** with self check-in.
- **Admissions:** families apply online; the office reviews and admits into student records.
- **School sign-up**, with set-up and optional approval.
- **PDFs:** report cards, transfer certificates and ID cards.
- **Two-factor sign-in:** an authenticator app, codes by email and backup codes.
- **A richer activity log:** who, what changed and where from, with filters and CSV.
- **Role-based homes** for admins, teachers, students and parents.

## 11 November 2026

- **Notification settings** at three levels (platform, organization, person), copies to co-teachers,
  and a weekly summary for owners.
- **Fine-grained permissions:** roles can grant single actions, such as grading without publishing.

## 10 November 2026

- **Platform staff roles** and one shared content library, with sharing to chosen colleges.
- **Courses** of library problems and questions, given to classes with release rules.
- **Templates:** assignments and exams written once and used for many classes.
- **Early warnings** for students who need attention, and **class discussions**.
- **Peer code review**, **GitHub projects** in assignments, a **calendar with an iCal feed**, and
  **certificates** with a public verification page.
- **LTI 1.3:** connect Moodle, Canvas or another LMS; grades go back to it.
- **Email** through an outbox with retries.
- Network-limited **lab exams** work on any host.

## 9 November 2026

- **Lab exams lock the site** during a sitting; problems written just for an assessment stay out of
  the library; problems can be imported from a file.
- Saving over someone else's newer edit is refused, with the choice to load theirs or keep yours.
- **Extensions and resubmission** for one student.
- **Notifications** with reminders and optional email.
- **A question bank** for quizzes in assignments, exams, contests and the daily challenge.
- Submissions that fail because of the judge are judged again automatically.

## 2 to 7 November 2026

- The first release: a coding lab with a secure code judge, the problem library, contests,
  assignments and a gradebook; then organizations with groups and roles; then classes, Markdown
  problems, saved drafts, feedback, lab exams and course outcomes.
