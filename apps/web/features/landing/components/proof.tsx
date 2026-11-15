import { cn } from "@workspace/ui/lib/utils"

import type { landingProof } from "../enquiries"

/*
 * Who uses GretLab, in their own words. Both parts come from Dashboard › Landing page, where
 * platform staff enter real institutions and quotes (with permission). With none, nothing
 * renders: the page never shows proof that isn't real.
 */

type Proof = Awaited<ReturnType<typeof landingProof>>

const KIND: Record<string, string> = { college: "College", cohort: "Cohort program", school: "School", other: "" }

export function Partners({ partners }: { partners: Proof["partners"] }) {
  if (partners.length === 0) return null
  return (
    <section aria-labelledby="partners-title" className="border-b border-hairline px-5 py-10 lg:px-10">
      <h2 id="partners-title" className="text-caption text-muted-foreground">
        Colleges and programs on GretLab
      </h2>
      <ul className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
        {partners.map((p) => (
          <li key={p.id}>
            <span className="block text-title-md text-ink">{p.name}</span>
            {KIND[p.kind] && <span className="text-caption text-muted-foreground">{KIND[p.kind]}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Testimonials({ testimonials }: { testimonials: Proof["testimonials"] }) {
  if (testimonials.length === 0) return null
  return (
    <section aria-labelledby="quotes-title" className="border-b border-hairline px-5 py-20 lg:px-10 lg:py-24">
      <h2 id="quotes-title" className="text-display-md text-ink lg:text-display-lg">
        In their <span className="font-semibold">words.</span>
      </h2>
      {/* As many columns as there are quotes, up to three, so no column stands empty. */}
      <div
        className={cn(
          "mt-10 grid overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10",
          testimonials.length >= 2 && "md:grid-cols-2",
          testimonials.length >= 3 && "lg:grid-cols-3"
        )}
      >
        {testimonials.map((t) => (
          <figure key={t.id} className="-mr-px -mb-px flex flex-col justify-between gap-6 border-r border-b border-hairline p-6 lg:p-8">
            <blockquote className="text-body-md text-ink">“{t.quote}”</blockquote>
            <figcaption className="text-caption text-muted-foreground">
              <span className="block text-body-sm font-medium text-ink">{t.name}</span>
              {t.role}, {t.institution}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
