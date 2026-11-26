// @ts-check
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

// The live address; DOCS_SITE_URL overrides it (a preview deploy, a local build).
const SITE = (process.env.DOCS_SITE_URL ?? "https://docs.gretlab.grettech.com").replace(/\/+$/, "")
// The app the docs describe.
const APP = "https://gretlab.grettech.com"

// The documentation site. Its pages are the repository's docs/ folder (src/content.config.ts).
export default defineConfig({
  site: SITE,
  integrations: [
    starlight({
      title: "GretLab Docs",
      description:
        "Guides for running GretLab: importing problems and questions, the organization API, lab exams and scaling.",
      logo: { src: "./src/assets/mark.svg", alt: "GretLab" },
      favicon: "/favicon.svg",
      // Every page: a share card (public/og.png), the large card on X, and who publishes the
      // site as structured data. Pages add their own breadcrumbs (components/PageTitle).
      head: [
        { tag: "meta", attrs: { property: "og:image", content: `${SITE}/og.png` } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: { property: "og:image:alt", content: "GretLab documentation" },
        },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${SITE}/og.png` } },
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          content: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": `${SITE}/#website`,
            name: "GretLab Docs",
            url: SITE,
            inLanguage: "en",
            publisher: {
              "@type": "Organization",
              name: "GretLab",
              url: APP,
              logo: `${APP}/icon.svg`,
            },
          }),
        },
      ],
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
            { label: "How GretLab works", slug: "start-here/how-gretlab-works" },
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
                { label: "Where code runs", slug: "features/coding/where-code-runs" },
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
                { label: "Profiles", slug: "features/people/profiles" },
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
                { label: "College single sign-on", slug: "features/platform/single-sign-on" },
                { label: "Your logo and colour", slug: "features/platform/branding" },
                { label: "Plans and billing", slug: "features/platform/plans-and-billing" },
                { label: "Site settings, search and legal", slug: "features/platform/site-settings" },
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
          ],
        },
        { label: "Changelog", slug: "changelog" },
      ],
    }),
  ],
})
