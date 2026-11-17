import Link from "next/link"
import type { ReactNode } from "react"

import { HomeLink } from "@/components/home-link"
import { LogoMark } from "@/components/logo"

import type { LegalFacts } from "../server"
import { Contents } from "./contents"

/*
 * The frame of a legal document (the privacy policy, the terms): a Read page. The title
 * and date, a short "In short" list for people who won't read the rest, then the sections,
 * with their contents beside them on wide screens and above them on phones.
 */

export interface LegalSection {
  id: string
  title: string
  body: ReactNode
}

const DOCS = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of use" },
] as const

export const LINK =
  "text-ink underline decoration-hairline-strong underline-offset-[3px] hover:decoration-ink"

export function LegalPage({
  facts,
  current,
  title,
  intro,
  summary,
  sections,
}: {
  facts: LegalFacts
  current: "/privacy" | "/terms"
  title: string
  intro: ReactNode
  /** The document in a few plain lines. */
  summary: ReactNode[]
  sections: LegalSection[]
}) {
  const other = DOCS.find((d) => d.href !== current)!
  const updated = new Date(`${facts.updated}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
  return (
    <div className="min-h-dvh bg-canvas text-body-md text-body">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <HomeLink
            className="flex items-center gap-2.5 text-title-sm font-semibold text-ink"
          >
            <LogoMark className="size-7 shrink-0 text-ink" />
            {facts.site}
          </HomeLink>
          <nav aria-label="Legal" className="flex gap-1 text-nav">
            {DOCS.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                aria-current={d.href === current ? "page" : undefined}
                className="rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-hairline-soft hover:text-ink aria-[current=page]:bg-hairline-soft aria-[current=page]:text-ink"
              >
                {d.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16 lg:py-16 max-lg:gap-8 max-lg:pt-8">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Contents sections={sections} />
        </aside>

        <main className="min-w-0 max-w-[68ch]">
          <h1 className="text-display-lg text-balance text-ink">{title}</h1>
          <p className="mt-3 text-body-sm text-muted-foreground">
            Last updated <time dateTime={facts.updated}>{updated}</time>
          </p>
          <div className="mt-6 grid gap-4">{intro}</div>

          <section
            aria-labelledby="in-short"
            className="mt-10 rounded-xl border border-hairline bg-card px-5 py-5 sm:px-6"
          >
            <h2 id="in-short" className="text-title-sm text-ink">
              In short
            </h2>
            <ul className="mt-3 grid list-disc gap-2 pl-5 marker:text-primary">
              {summary.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>

          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="mt-12 scroll-mt-8 border-t border-hairline pt-8"
            >
              <h2 id={`${s.id}-title`} className="text-title-md text-balance text-ink">
                {s.title}
              </h2>
              <div className="mt-4 grid gap-4">{s.body}</div>
            </section>
          ))}

          <p className="mt-14 border-t border-hairline pt-6 text-body-sm text-muted-foreground">
            Read the{" "}
            <Link href={other.href} className={LINK}>
              {other.label.toLowerCase()}
            </Link>{" "}
            too. Back to{" "}
            <HomeLink className={LINK}>
              {facts.site}
            </HomeLink>
            .
          </p>
        </main>
      </div>
    </div>
  )
}

/** A bulleted list inside a section. */
export function List({ children }: { children: ReactNode }) {
  return <ul className="grid list-disc gap-2 pl-5 marker:text-muted-foreground">{children}</ul>
}

/** A term and what it means, in a list. */
export function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <li>
      <span className="font-medium text-ink">{term}:</span> {children}
    </li>
  )
}

/** How to reach whoever runs the site, from the Legal settings. */
export function Contact({ facts }: { facts: LegalFacts }) {
  return (
    <List>
      <Item term="Who runs it">{facts.operator}</Item>
      {facts.email ? (
        <Item term="Email">
          <a href={`mailto:${facts.email}`} className={LINK}>
            {facts.email}
          </a>
        </Item>
      ) : (
        <Item term="Email">ask through your organization or the site's administrators until an address is listed here</Item>
      )}
      {facts.grievanceOfficer && <Item term="Grievance officer">{facts.grievanceOfficer}</Item>}
      {facts.address && <Item term="Post">{facts.address}</Item>}
    </List>
  )
}

/** "Privacy · Terms": for footers and sign-in pages. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <span className={className}>
      <Link href="/privacy">Privacy</Link>
      <span aria-hidden="true"> · </span>
      <Link href="/terms">Terms</Link>
    </span>
  )
}
