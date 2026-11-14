// @ts-check
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

// The documentation site. Its pages are the repository's docs/ folder (src/content.config.ts).
export default defineConfig({
  // The live address; DOCS_SITE_URL overrides it (a preview deploy, a local build).
  site: process.env.DOCS_SITE_URL ?? "https://docs.gretlab.grettech.com",
  integrations: [
    starlight({
      title: "Gretlab Docs",
      description:
        "Guides for running Gretlab: importing problems and questions, the organization API, lab exams and scaling.",
      logo: { src: "./src/assets/mark.svg", alt: "Gretlab" },
      favicon: "/favicon.svg",
      customCss: [
        "@fontsource-variable/inter",
        "@fontsource/jetbrains-mono/400.css",
        "./src/styles/theme.css",
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/exewhyz/gretlab",
        },
      ],
      editLink: {
        // Pages come from ../../docs, so their paths start with ../../ and resolve to docs/.
        baseUrl: "https://github.com/exewhyz/gretlab/edit/main/apps/docs/",
      },
      components: {
        Header: "./src/components/Header.astro",
        PageTitle: "./src/components/PageTitle.astro",
      },
      // Top-level groups are the header's section tabs; only pages that exist are listed.
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "start-here/introduction" },
            { label: "How Gretlab works", slug: "start-here/how-gretlab-works" },
            { label: "Roles at a glance", slug: "start-here/roles-at-a-glance" },
            { label: "Kinds of organization", slug: "start-here/kinds-of-organization" },
            { label: "Glossary", slug: "start-here/glossary" },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "Features overview", slug: "features/overview" },
            {
              label: "Coding lab",
              collapsed: true,
              items: [
                { label: "Problems and practice", slug: "features/coding/problems-and-practice" },
                { label: "Run and Submit", slug: "features/coding/run-and-submit" },
                { label: "Assignments and the gradebook", slug: "features/coding/assignments" },
                { label: "Quizzes and the question bank", slug: "features/coding/quizzes" },
                { label: "Lab exams", slug: "features/coding/lab-exams" },
                { label: "Contests", slug: "features/coding/contests" },
                { label: "Templates", slug: "features/coding/templates" },
                { label: "Courses", slug: "features/coding/courses" },
                { label: "The content library", slug: "features/coding/content-library" },
                { label: "Peer review", slug: "features/coding/peer-review" },
                { label: "GitHub projects", slug: "features/coding/github-projects" },
              ],
            },
            {
              label: "Classes",
              collapsed: true,
              items: [
                { label: "Class pages", slug: "features/classes/class-pages" },
                { label: "Discussions", slug: "features/classes/discussions" },
                { label: "Early warnings", slug: "features/classes/early-warnings" },
                { label: "Certificates", slug: "features/classes/certificates" },
              ],
            },
            {
              label: "Every day",
              collapsed: true,
              items: [
                { label: "Attendance", slug: "features/daily/attendance" },
                { label: "Staff attendance", slug: "features/daily/staff-attendance" },
                { label: "Timetable", slug: "features/daily/timetable" },
                { label: "Leave", slug: "features/daily/leave" },
                { label: "Holidays", slug: "features/daily/holidays" },
                { label: "Notices", slug: "features/daily/notices" },
              ],
            },
            {
              label: "People",
              collapsed: true,
              items: [
                { label: "Members, groups and roles", slug: "features/people/members-groups-roles" },
                { label: "Student records", slug: "features/people/student-records" },
                { label: "Admissions", slug: "features/people/admissions" },
                { label: "Parent accounts", slug: "features/people/parent-accounts" },
              ],
            },
            {
              label: "Academics",
              collapsed: true,
              items: [
                { label: "Subjects", slug: "features/assessment/subjects" },
                { label: "Exams and report cards", slug: "features/assessment/exams-and-report-cards" },
                { label: "Course and program outcomes", slug: "features/assessment/outcomes" },
              ],
            },
            {
              label: "Campus",
              collapsed: true,
              items: [
                { label: "The library desk", slug: "features/campus/library-desk" },
                { label: "Transport", slug: "features/campus/transport" },
                { label: "Hostel", slug: "features/campus/hostel" },
              ],
            },
            {
              label: "Programs",
              collapsed: true,
              items: [
                { label: "Cohort runs and mentors", slug: "features/programs/cohort-runs" },
                { label: "Assigned training", slug: "features/programs/training" },
                { label: "Events and open groups", slug: "features/programs/events" },
              ],
            },
            {
              label: "Communication and reports",
              collapsed: true,
              items: [
                { label: "Notifications and email", slug: "features/communication/notifications" },
                { label: "Calendar", slug: "features/communication/calendar" },
                { label: "Reports", slug: "features/communication/reports" },
              ],
            },
            {
              label: "Platform and security",
              collapsed: true,
              items: [
                { label: "Sign-in and two-factor", slug: "features/platform/two-factor" },
                { label: "Activity log", slug: "features/platform/activity-log" },
                { label: "Platform staff and organizations", slug: "features/platform/platform-staff" },
                { label: "LTI 1.3", slug: "features/platform/lti" },
              ],
            },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Problem file format", slug: "problem-format" },
            { label: "Question file format", slug: "question-format" },
            { label: "The organization API", slug: "api" },
          ],
        },
        {
          label: "Setup & operations",
          items: [
            { label: "Installation", slug: "setup/installation" },
            { label: "Demo data", slug: "setup/demo-data" },
            { label: "Lab exams on your deployment", slug: "deploy-exams" },
            { label: "Scaling and operations", slug: "scaling" },
            { label: "Editing the docs", slug: "setup/editing-the-docs" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Roles", link: "/reference/roles/" },
            { label: "Permissions", link: "/reference/permissions/" },
            { label: "Kinds and modules", link: "/reference/kinds-and-modules/" },
            { label: "Demo accounts", slug: "reference/demo-accounts" },
          ],
        },
      ],
    }),
  ],
})
