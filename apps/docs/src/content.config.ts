import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { docsSchema } from "@astrojs/starlight/schema"

/*
 * The site's pages are the repository's own docs/ folder, so a guide has one home: it reads
 * on GitHub, the app and code can point at docs/<name>.md, and the site publishes it.
 * Each file needs a `title` in its frontmatter; docs/index.md is the home page. Pages are
 * plain Markdown: files there can't import this app's packages, and Markdown reads on GitHub.
 */
export const collections = {
  docs: defineCollection({
    loader: glob({ base: "../../docs", pattern: "**/*.md" }),
    schema: docsSchema(),
  }),
}
