---
title: Changelog
description: What's new in GretLab, newest first.
---

What changed for the people using GretLab, newest first. Fixes and changes that don't show to anyone
aren't listed.

## 23 November 2026

### Judges sign in with a login that can only judge

- Judges run students' code, so they now sign in to the database with their own login that can
  only judge: it reads the queue and the tests and records results. It can't see people, grades
  or anything else, and can't delete graded work. Dashboard › Judges shows which login each judge
  uses. Operators switch over once, as the README describes.
- Monitoring's chart tables open in a side panel with each line's highest value and average.

## 22 November 2026

### Automatic scaling, monitoring and costs

- **Judges can scale themselves** (Dashboard › Judges › Judge settings, off until switched on):
  another judge starts when code has waited 30 seconds or an exam is about to open, and the
  ones it started end once they've been idle for 20 minutes. It never goes past the limit you
  set, and never ends a judge a person started.
- **Dashboard › Monitoring** shows whether everything is healthy and what's wrong right now, the
  four golden signals, and charts over the last hour, 6 hours, day or week: how much code is
  judged, how long it waits (with the slow and outage lines), errors, how full the judges are,
  and email and webhooks sent and failed, with the reasons. Every chart opens as a table.
- **Dashboard › Costs** shows what judge machines cost this month, by organization, with a
  forecast for the month.

### Judge machines from the dashboard

- **Update judges from the dashboard.** Each judge shows which version of the code it runs, and
  ones behind the site are marked. **Update** replaces a judge with a fresh one running the
  latest code, one at a time, so nothing slows down; if the new one fails, the old one keeps
  working. A **Setup check** tries everything a start needs and says in plain words what's wrong,
  and a judge that fails to set up shows the end of its log.
- **Start and stop judges from Dashboard › Judges** (platform staff with "Manage judges"): a
  machine for everyone or for one organization, with its progress as it starts. Stop lets it
  finish its work first. A limit on how many run at once keeps costs in hand.

### An organization's own judges

- **A college can have judges of its own.** Its students' code then runs only on its own
  machines, so its exams aren't slowed by anyone else's load; when those machines are idle they
  help everyone else. If they stop, its work moves to the shared judges until they're back.
  How to set one up: Scaling and operations › An organization's own judges.

### Faster from India

- **Pages and saves are quicker** for people in India: the website and its database now run in
  Mumbai instead of Sydney, so each request no longer crosses to Australia and back.
- **The privacy policy** says where data is kept now: the website and the database in India,
  submitted code run in Australia.
- **Large organizations.** A notice to a whole year of thousands of students now reaches every
  one of them, and their parents, in the bell and by email. Before, past about 13,000 people it
  quietly reached nobody.
- **Imports are much faster.** 5,000 members, or 3,000 student records, are added in about a
  second instead of half a minute. A file with two people whose emails start the same way
  (john@ at two schools) no longer fails as a whole.
- **Gradebooks show 100 students at a time,** with search, so an assignment for a whole year of
  thousands opens quickly; the figures above still count everyone, and the CSV has everyone.
  Moving between pages is instant, and a new mark or submission shows straight away.
- **Fewer waits on each page.** The first page you open, a problem, a class, and the first
  management page of an organization now ask the server for everything at once instead of one
  thing after another, so they appear sooner.

## 20 November 2026

### Faster problem pages

- **The editor no longer jumps** while the playground or a problem page loads: the toolbar,
  notices and file tabs appear once, at their final size.
- **The problem shows first.** Your code appears at once as plain text, and the full editor
  starts a moment later (or as soon as you click into the code).
- **Topic pages** (`/problems/topics`) open faster: they no longer wait on the database before
  the saved copy is sent.

## 19 November 2026

### Where code runs, and Submit without the server

- **Python and JavaScript run in the browser** whenever the server can't run code, and for
  visitors. Only those two languages are offered then.
- **Grade in the browser** (Dashboard › Settings › Execution, off by default): lets Submit work
  while server execution is off. The browser runs every test's input and the server checks the
  outputs, so expected outputs never leave the server. Hidden tests' inputs do reach the
  student's browser. Such results are marked **Provisional**, and the server judges the same code
  again once it's back; that verdict replaces the provisional one. It's used for library
  practice, and by organizations that turn it on.
- **An organization's own switches** (Manage › Settings › Code execution): turn server execution
  off for your own work if the judge is failing, and allow grading in the browser. You can only
  narrow what the platform allows.
- **Each assignment and contest** chooses where its code runs: on the server, or in the students'
  browsers (Python and JavaScript only, with a warning in the form). It can also set a lower
  **submission limit per minute** than the platform's, never a higher one.
- How the three levels fit together: [Where code runs](/features/coding/where-code-runs/).

### Profiles

- **Account** (account menu) has two tabs: **Profile** (your name, profile address, headline,
  about you, city, links and phone) and **Security**. A checklist shows what's still missing.
- **A profile in each organization**: open anyone from Members, or your own from the sidebar's
  footer. It shows their roles and classes and the people linked to them: a student's record and
  parents, a parent's children, a teacher's subjects and classes. Staff profiles have a
  designation, department, staff number and start date, which staff can fill in themselves
  (their staff number is set by the office). Each part shows only to people allowed to see it.
  See [Profiles](/features/people/profiles/).

### For the platform

- **Modules for one organization** (Dashboard › Organizations › Modules): set any module off,
  optional or on from the start for that organization alone, over what its kind allows. See
  [Platform staff and organizations](/features/platform/platform-staff/).

### Around the site

- Saves and failures show a short notice in the corner, and a thin bar along the top shows a page
  or a save is on its way.
- The dashboards' header and sidebar show the GretLab logo. The sidebar has a footer with your
  profile, Account, and the docs.
- The page you're on stays in view in a long sidebar, problem list or row of tabs.
- Organization pages load a little faster: the sidebar's data is fetched in one go.
- The privacy policy says what profiles keep and who sees them.
- Search results describe the problem library and the playground more accurately: Python and
  JavaScript run in your browser, and other languages once you sign in.

## 17 November 2026

### Readings, quizzes, labs and projects in courses

- A course module can now have a **quiz**, a **lab** and a **project**, each optional. Tick them
  while writing the module, then choose questions or problems, points, a time limit and a weight.
- Students take a quiz or lab in **one attempt**, timed if you set a limit. A lab counts graded
  submissions made during the attempt. A project is handed in as a GitHub repository and marked
  by a teacher, with feedback.
- **Grades** on a class's course shows each student's scores and their **course grade**. Click a
  score to mark a project or let a student try a quiz or lab again.
- **Readings:** write lesson pages in a module (**Write a reading**, in markdown). Students read
  them on their own page with the module beside it, Previous and Next, and **Mark as completed**,
  which counts toward finishing the module.
- **Make a copy** now copies your own courses too, for example to run a new round of renewed
  training with fresh quizzes, labs and projects.

### The landing page and the logo

- The landing page at the site's address now opens for signed-in people too, with **Your home**
  in its header. Signing in still takes you to your home.
- The logo takes you to your home when you're signed in, and to the landing page when you're not.
- Email previews and test emails (**Dashboard › Emails**) now link to your site's own address
  instead of a made-up one.

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
