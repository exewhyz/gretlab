import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { LogoMark } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { LegalLinks } from "@/features/legal/components/legal-page"

import { AROUND, TRUST, type Audience } from "../content"
import type { landingProof } from "../enquiries"
import type { LandingFacts } from "../server"
import { ContactForm } from "./contact-form"
import { CopyEmail } from "./copy-email"
import { Faq } from "./faq"
import { LabSection } from "./lab-section"
import { Partners, Testimonials } from "./proof"
import { TimetableHero } from "./timetable-hero"

/*
 * The landing page (/), shown to visitors and signed-in people alike, for colleges and cohort programs: a week with the headline
 * set into it (switchable between a college and a cohort), the coding lab as one
 * submission followed to the gradebook, what sits around the lab for each audience, a line
 * of what's under the hood, and a close. Short on purpose: the screens do the explaining.
 */

/** Buttons on this page press in slightly. */
const press = "transition-[color,background-color,transform] duration-150 active:scale-[0.98]"

function Primary({ facts, size = "lg" }: { facts: LandingFacts; size?: "lg" | "default" | "sm" }) {
  const { primary } = facts
  const cls = cn(buttonVariants({ size }), press)
  return primary.kind === "contact" ? (
    <a href={primary.href} className={cls}>
      {primary.label}
    </a>
  ) : (
    <Link href={primary.href} className={cls}>
      {primary.label}
    </Link>
  )
}

function Lab({ facts }: { facts: LandingFacts }) {
  if (!facts.lab) return null
  return (
    <Link href={facts.lab.href} className={cn(buttonVariants({ variant: "outline", size: "lg" }), press)}>
      {facts.lab.label}
    </Link>
  )
}

export function Landing({
  facts,
  proof,
  signedIn = false,
}: {
  facts: LandingFacts
  proof: Awaited<ReturnType<typeof landingProof>>
  /** Signed-in people get a link to their home instead of "Sign in". */
  signedIn?: boolean
}) {
  return (
    <div className="min-h-dvh bg-canvas text-body">
      <Header facts={facts} signedIn={signedIn} />
      <div className="mx-auto max-w-[80rem] lg:px-6">
        <div className="relative border-hairline lg:border-x">
          <Corners />
          <main>
            <div className="px-5 pt-8 pb-14 lg:p-0">
              <TimetableHero headline={<Headline facts={facts} />} />
              <p className="mt-4 text-caption text-muted-foreground lg:px-10 lg:pb-6">
                An example week. The college, cohort, people and numbers are made up.
              </p>
            </div>
            <Partners partners={proof.partners} />
            <LabSection />
            <Around />
            <Testimonials testimonials={proof.testimonials} />
            <Faq />
            <Trust />
            <Close facts={facts} />
          </main>
        </div>
      </div>
      <Footer facts={facts} />
    </div>
  )
}

function Header({ facts, signedIn }: { facts: LandingFacts; signedIn: boolean }) {
  const links: [string, string][] = [
    ["The coding lab", "#lab"],
    ["Colleges and cohorts", "#around"],
    ["Questions", "#faq"],
  ]
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[80rem] items-center gap-6 px-5 lg:px-12">
        <Link href="/" className="flex items-center gap-2.5 text-title-sm font-semibold text-ink">
          <LogoMark className="size-7 shrink-0 text-ink" />
          {facts.site}
        </Link>
        <nav aria-label="Landing" className="hidden items-center gap-1 text-nav md:flex">
          {links.map(([label, href]) => (
            <a key={href} href={href} className="rounded-md px-3 py-2 text-body hover:bg-hairline-soft hover:text-ink">
              {label}
            </a>
          ))}
          <a href={facts.docsUrl} className="rounded-md px-3 py-2 text-body hover:bg-hairline-soft hover:text-ink">
            Docs
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Link
            href={signedIn ? "/home" : "/sign-in"}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), !signedIn && "hidden sm:inline-flex")}
          >
            {signedIn ? "Your home" : "Sign in"}
          </Link>
          <Primary facts={facts} size="sm" />
        </div>
      </div>
    </header>
  )
}

function Headline({ facts }: { facts: LandingFacts }) {
  return (
    <div>
      <h1 id="landing-title" className="text-display-lg text-balance text-ink sm:text-display-xl">
        <span className="font-semibold">
          The coding lab that{" "}
          <span className="relative inline-block whitespace-nowrap">
            <span className="relative z-10">grades itself.</span>
            {/* The framed words, tagged with the verdict they produce. */}
            <span aria-hidden className="absolute -inset-x-1.5 -inset-y-0.5 rounded-xs ring-1 ring-ink/70">
              {["-left-[3px] -top-[3px]", "-right-[3px] -top-[3px]", "-left-[3px] -bottom-[3px]", "-right-[3px] -bottom-[3px]"].map((pos) => (
                <span key={pos} className={cn("absolute size-1.5 bg-card ring-1 ring-ink/70", pos)} />
              ))}
              <span className="absolute right-0 -bottom-1 translate-y-full rounded-sm bg-success px-1.5 py-0.5 text-caption leading-none font-medium tracking-normal text-card">
                Accepted · 12/12
              </span>
            </span>
          </span>
        </span>
        <span className="mt-4 block text-body">For colleges and cohorts.</span>
      </h1>
      <p className="mt-5 max-w-[64ch] text-body-md text-body">
        Lab exams, assignments and contests, judged in a sandbox and graded the same minute.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Primary facts={facts} />
        <Lab facts={facts} />
      </div>
    </div>
  )
}

function Corners() {
  return (
    <span aria-hidden className="pointer-events-none hidden lg:block">
      {["-left-[4.5px] -top-[4.5px]", "-right-[4.5px] -top-[4.5px]"].map((pos) => (
        <span key={pos} className={cn("absolute size-2 rounded-full border border-hairline-strong bg-canvas", pos)} />
      ))}
    </span>
  )
}

function Around() {
  return (
    <section id="around" aria-labelledby="around-title" className="scroll-mt-20 border-b border-hairline px-5 py-20 lg:px-10 lg:py-24">
      <h2 id="around-title" className="max-w-[24ch] text-display-md text-balance text-ink lg:text-display-lg">
        Around the lab, <span className="font-semibold">the rest of the term.</span>
      </h2>
      <div className="mt-10 grid overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 md:grid-cols-2">
        {(Object.keys(AROUND) as Audience[]).map((a, i) => (
          <div key={a} className={cn(i > 0 && "border-t border-hairline md:border-t-0 md:border-l")}>
            <h3 className="border-b border-hairline px-5 py-3.5 text-title-sm text-ink">{AROUND[a].title}</h3>
            <ul>
              {AROUND[a].items.map(([name, what]) => (
                <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-hairline-soft px-5 py-3.5 last:border-0">
                  <span className="text-body-sm font-medium text-ink">{name}</span>
                  <span className="text-caption text-muted-foreground">{what}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 text-caption text-muted-foreground">
        Also runs schools, coaching centres and company training, each in its own words.
      </p>
    </section>
  )
}

function Trust() {
  return (
    <section aria-label="Under the hood" className="border-b border-hairline px-5 py-6 lg:px-10">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-caption text-body">
        {TRUST.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-hairline-strong" />
            {t}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Close({ facts }: { facts: LandingFacts }) {
  return (
    <section id="contact" aria-labelledby="close-title" className="scroll-mt-20 grid gap-10 px-5 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:px-10 lg:py-28">
      <div>
        <h2 id="close-title" className="max-w-[16ch] text-display-lg text-balance text-ink sm:text-display-xl">
          Run your next lab <span className="font-semibold">on {facts.site}.</span>
        </h2>
        <p className="mt-6 max-w-[44ch] text-body-md text-body">
          Tell us about your college or program, and we'll set it up with you.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {facts.primary.kind === "register" && <Primary facts={facts} />}
          <Lab facts={facts} />
        </div>
        {facts.email && (
          <p className="mt-6 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
            Or write to <CopyEmail email={facts.email} />
          </p>
        )}
      </div>
      <ContactForm />
    </section>
  )
}

function Footer({ facts }: { facts: LandingFacts }) {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-[80rem] flex-col gap-6 px-5 py-10 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-12">
        <span className="flex items-center gap-2.5 text-body-sm text-ink">
          <LogoMark className="size-6 shrink-0 text-ink" />
          {facts.site}
        </span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 [&_a:hover]:text-ink">
          {facts.lab && <Link href="/problems">Problems</Link>}
          <Link href="/contests">Contests</Link>
          <a href={facts.docsUrl}>Docs</a>
          <a href={`${facts.docsUrl}/changelog/`}>Changelog</a>
          <LegalLinks />
        </nav>
      </div>
    </footer>
  )
}
