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

Live at https://docs.gretlab.grettech.com (the default `site` in `astro.config.mjs`;
`DOCS_SITE_URL` overrides it).

## Deploying on Vercel

A separate Vercel project from the web app, on the same repository:

- **Root Directory:** `apps/docs` (Vercel installs the pnpm workspace from the repository root).
- **Framework Preset:** Astro. Build command `astro build`, output directory `dist` (the defaults).
- **Domain:** `docs.gretlab.grettech.com`.
- **Environment variables:** none needed.
