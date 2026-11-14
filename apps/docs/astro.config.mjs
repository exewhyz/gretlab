// @ts-check
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

// The documentation site. Its pages are the repository's docs/ folder (src/content.config.ts).
export default defineConfig({
  site: process.env.DOCS_SITE_URL ?? "http://localhost:4321",
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
      sidebar: [
        {
          label: "Content",
          items: [
            { label: "Problem file format", slug: "problem-format" },
            { label: "Question file format", slug: "question-format" },
          ],
        },
        {
          label: "Integrations",
          items: [{ label: "The organization API", slug: "api" }],
        },
        {
          label: "Running Gretlab",
          items: [
            { label: "Lab exams on your deployment", slug: "deploy-exams" },
            { label: "Scaling and operations", slug: "scaling" },
          ],
        },
      ],
    }),
  ],
})
