import type { Metadata } from "next"

import { verifyCertificate } from "@/features/certificates/server"
import { getSettings } from "@/features/settings/server"
import { formatDate, formatDay } from "@/lib/format"

import { PrintButton } from "@/features/certificates/components/print-button"

export const metadata: Metadata = { title: "Certificate", robots: { index: false } }

/** A certificate's public page: anyone can check it, no sign-in. Prints as the certificate. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const [c, settings] = await Promise.all([verifyCertificate(code), getSettings()])
  const site = settings["site.title"] || "Gretlab"
  if (!c) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-xl content-center gap-2 p-6 text-center">
        <h1 className="text-display-sm text-ink">No certificate with that code</h1>
        <p className="text-body-sm text-body">
          Check the code (it looks like ABCDE-23456). Certificates from {site} are checked here.
        </p>
      </main>
    )
  }
  return (
    <main className="mx-auto grid min-h-dvh max-w-3xl content-center gap-4 p-6 print:p-0">
      <article
        data-testid="certificate"
        className="grid gap-5 rounded-2xl border-4 border-double border-primary/50 bg-card p-10 text-center shadow-sm print:shadow-none"
      >
        <p className="text-caption-upper tracking-widest text-primary uppercase">
          Certificate{c.org ? ` · ${c.org}` : ""}
        </p>
        <p className="text-body-sm text-body">This certifies that</p>
        <h1 className="text-display-lg text-ink">{c.name}</h1>
        <p className="text-body-sm text-body">has earned</p>
        <h2 className="text-display-sm text-ink">{c.title}</h2>
        {c.detail && <p className="mx-auto max-w-lg text-body-sm text-body">{c.detail}</p>}
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-1 text-caption">
          <span>Issued {formatDate(c.issuedAt)}</span>
          {c.expiresOn && <span>Valid until {formatDay(c.expiresOn)}</span>}
          {c.issuer && <span>By {c.issuer}</span>}
          <span className="font-mono">{c.code}</span>
        </div>
      </article>
      <p
        data-testid="certificate-status"
        className={
          c.revokedAt || c.expired
            ? "rounded-md bg-destructive/10 p-2 text-center text-body-sm text-destructive"
            : "rounded-md bg-success/10 p-2 text-center text-body-sm text-success print:hidden"
        }
      >
        {c.revokedAt
          ? `Revoked on ${formatDate(c.revokedAt)}: this certificate is no longer valid.`
          : c.expired
            ? `Expired on ${formatDay(c.expiresOn!)}: it had to be renewed by then.`
            : c.expiresOn
              ? `Valid until ${formatDay(c.expiresOn)}: issued through ${site}. Anyone can check it at this address.`
              : `Valid: issued through ${site}. Anyone can check it at this address.`}
      </p>
      <div className="flex justify-center print:hidden">
        <PrintButton />
      </div>
    </main>
  )
}
