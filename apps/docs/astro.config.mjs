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
              items: [
                { label: "Problems and practice", slug: "features/coding/problems-and-practice" },
                { label: "Run and Submit", slug: "features/coding/run-and-submit" },
                { label: "Assignments and the gradebook", slug: "features/coding/assignments" },
                { label: "Quizzes and the question bank", slug: "features/coding/quizzes" },
                { label: "Lab exams", slug: "features/coding/lab-exams" },
                { label: "Contests", slug: "features/coding/contests" },
              ],
            },
            {
              label: "Every day",
              items: [
                { label: "Attendance", slug: "features/daily/attendance" },
                { label: "Timetable", slug: "features/daily/timetable" },
                { label: "Leave", slug: "features/daily/leave" },
              ],
            },
            {
              label: "People",
              items: [
                { label: "Members, groups and roles", slug: "features/people/members-groups-roles" },
                { label: "Student records", slug: "features/people/student-records" },
              ],
            },
            {
              label: "Assessment",
              items: [
                { label: "Exams and report cards", slug: "features/assessment/exams-and-report-cards" },
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
