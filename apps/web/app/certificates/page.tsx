import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { myCertificates } from "@/features/certificates/server"
import { formatDate, formatDay } from "@/lib/format"

export const metadata: Metadata = { title: "My certificates", robots: { index: false } }

export default async function Page() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?callbackUrl=/certificates")
  const list = await myCertificates(user)
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto grid max-w-4xl gap-4 p-4">
        <div>
          <h1 className="text-display-lg text-ink">My certificates</h1>
          <p className="text-body-sm text-body">
            Each has a public page anyone can open to check it: share its link on a CV or profile.
          </p>
        </div>
        {list.length === 0 ? (
          <p className="text-body-sm text-body">None yet. Finish a course in one of your classes to earn one.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {list.map((c) => (
              <li key={c.code}>
                <Link
                  href={`/certificates/${c.code}`}
                  data-testid="my-certificate"
                  className="grid gap-1 rounded-lg border border-hairline bg-card p-4 hover:bg-muted/40"
                >
                  <span className="font-semibold text-ink">{c.title}</span>
                  <span className="text-caption">
                    {c.org ?? "Gretlab"} · {formatDate(c.issuedAt)}
                    {c.revoked
                      ? " · Revoked"
                      : c.expired
                        ? " · Expired"
                        : c.expiresOn
                          ? ` · Valid until ${formatDay(c.expiresOn)}`
                          : ""}
                  </span>
                  <span className="font-mono text-xs text-body">{c.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
