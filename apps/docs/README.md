# Gretlab docs

The documentation site, built with [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build).

Its pages are the repository's own `docs/` folder (see `src/content.config.ts`), so each
guide has one home: it reads on GitHub, the app and code point at `docs/<name>.md`, and
this site publishes it.

- **Add a page:** a Markdown file in `docs/` with a `title` (and `description`) in its
  frontmatter, and an entry in the sidebar in `astro.config.mjs`. Plain Markdown only:
  files in `docs/` can't import this app's packages.
- **Look:** Gretlab's tokens on Starlight's variables, in `src/styles/theme.css`
  (`apps/web/DESIGN.md` is the source).

```sh
pnpm --filter docs dev        # http://localhost:4321
pnpm --filter docs build      # static site in apps/docs/dist
pnpm --filter docs typecheck  # astro check
```

`DOCS_SITE_URL` sets the site's address for the sitemap and links when it's deployed.
