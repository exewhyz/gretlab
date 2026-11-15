---
title: Site settings, search and legal pages
description: The site's name and address, what search engines see, the privacy policy and terms, and the logo, all set from the platform dashboard.
glance:
  who:
    - role: Platform owner
      note: sets the site's details
  where:
    path: /admin/settings
    menu: "Dashboard › Settings"
  permissions: [platform.settings.manage]
---

The platform's **Settings** page holds what the whole site says about itself. Three groups matter
beyond features and limits: the site's name, **Search engines** and **Legal**.

## Search engines

| Setting | What it does |
| --- | --- |
| Site title | The site's name: the top bar, page titles, search results and link previews |
| Site address | The public address used for canonical links, the sitemap, structured data and share cards. Without a slash at the end |
| Site description | What search results and link previews say for pages without their own. About 150 characters |
| Tagline | The home page's title and the share card's headline |
| Let search engines index the site | Off: every page asks not to be indexed and `robots.txt` turns crawlers away. For a staging or private copy |
| Google Search Console code | The `content` of the verification tag Search Console gives you |
| Bing Webmaster Tools code | The `content` of Bing's `msvalidate.01` tag |

Changes reach every page within five minutes. `robots.txt` and `sitemap.xml` follow at once.

### What search engines get

- **Public pages** (problems, a problem, topics, contests, the playground, privacy and terms) have their
  own titles, descriptions and canonical addresses. Everything else asks not to be indexed.
- **`/sitemap.xml`** lists those pages, every public problem and every topic.
- **Structured data:** the site and its publisher on every page; a problem as a learning resource; a
  topic as a collection of problems; breadcrumbs on each.
- **Share cards:** links to the site, and to each problem, show a card with the name, the title and the
  address. The docs have their own.

### Verifying the site

1. In Google Search Console, add a **URL prefix** property with the site address and choose
   **HTML tag**. Copy the value inside `content="…"`.
2. Paste it into **Google Search Console code** and save. Wait about five minutes, then press **Verify**.
3. Submit `sitemap.xml` under **Sitemaps**.
4. In Bing Webmaster Tools, **Import from Google Search Console** (no code needed), or use the Bing code
   setting the same way.

## Landing page

The front page's contact form and its proof are managed on **Dashboard › Landing page**:

- **Enquiries:** every request sent from the form, newest first, with search and a New / Handled
  filter. Mark one handled once you've replied. Shown to staff who manage organizations.
- **Partners and testimonials:** institutions that use GretLab, and quotes from people there. Add
  only real ones, with their permission. Each section appears on the page only once it has an
  entry, and disappears again when the last is removed. Shown to staff with Platform settings.

In **Dashboard › Settings › Landing page**, **Contact email for organizations** is where each new
enquiry is also emailed. Leave it empty and enquiries are still listed on the dashboard.

## Legal

The privacy policy (`/privacy`) and terms of use (`/terms`) are written into the app and name whoever
runs the site from these settings:

| Setting | Used for |
| --- | --- |
| Who runs the site | The person or company named in both pages. Empty: the site's name |
| Contact email | Where people send privacy requests, complaints and questions. Shown on both pages |
| Grievance officer | Who answers privacy complaints (India's DPDP Act and IT Rules ask for one). Optional |
| Postal address | Optional |
| Governing law | Whose laws the terms follow and whose courts hear disputes. Default: India |

Sign-in and sign-up say that continuing accepts both pages, and every sign-in page and problem page
links them. There is no button to delete an account: people write to the contact email.

## The logo

GretLab's mark is code braces holding a check: code goes in and comes back judged and graded. It's the
site's icon, the home-screen icon on phones, the logo search engines show, and the share cards. It
isn't a setting; changing it is a code change.

## Edge cases

- Leave **Site address** as the address people actually use. Search engines treat it as the real one.
- With indexing off, pages already in search results drop out over the following weeks.
- The legal pages are a starting point. Have them reviewed before relying on them.

## Related

- [Problems and practice](/features/coding/problems-and-practice/)
- [Platform staff and organizations](/features/platform/platform-staff/)
