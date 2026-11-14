import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { docsSchema } from "@astrojs/starlight/schema"
import { z } from "astro/zod"

import { isModuleKey, isPermissionKey } from "./data/catalog"

/*
 * The site's pages are the repository's own docs/ folder, so a guide has one home: it reads
 * on GitHub, the app and code can point at docs/<name>.md, and the site publishes it.
 * Pages are plain Markdown: files there can't import this app's packages, and Markdown
 * reads on GitHub. Each needs a `title` (and a one-line `description`) in its frontmatter.
 *
 * A feature page can also say, in `glance`, who uses it, where it is in the app, and the
 * permissions and module behind it; the page's top turns that into the "At a glance" cards.
 * Permission and module keys are checked against the app's own lists, so a renamed one
 * fails the build instead of going stale.
 */
const glance = z
  .object({
    /** Who uses it: a role and, optionally, what for ("own classes"). */
    who: z
      .array(z.object({ role: z.string(), note: z.string().optional() }))
      .optional(),
    /** Where it is: an address in the app and the menu that leads there. */
    where: z
      .object({ path: z.string().optional(), menu: z.string().optional() })
      .optional(),
    /** The permissions behind it, by key (organization or platform). */
    permissions: z
      .array(
        z.string().refine(isPermissionKey, {
          message: "Not a permission in packages/judge (permissions.ts or platform.ts)",
        })
      )
      .optional(),
    /** The module it belongs to, by key; the cards say which kinds have it. */
    module: z
      .string()
      .refine(isModuleKey, { message: "Not a module in packages/judge/src/org-types.ts" })
      .optional(),
  })
  // Strict: an unknown field fails the build. There is deliberately no field for demo
  // accounts or passwords; sign-in details never go in the public docs.
  .strict()
  .optional()

export const collections = {
  docs: defineCollection({
    loader: glob({ base: "../../docs", pattern: "**/*.md" }),
    schema: docsSchema({ extend: z.object({ glance }) }),
  }),
}
