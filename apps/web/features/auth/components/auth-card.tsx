import Link from "next/link"
import type { ReactNode } from "react"

/** The frame of the sign-in pages: the site's mark, a title, and the form in a card. */
export function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10 text-body-sm text-body">
      <div className="grid w-full max-w-sm gap-6">
        <Link href="/" className="justify-self-center font-mono text-title-md font-semibold text-primary">
          &gt;&gt;&gt; gretlab
        </Link>
        <div className="grid gap-5 rounded-2xl bg-card p-6 shadow-xs ring-1 ring-foreground/10 sm:p-8">
          <div className="grid gap-1.5 text-center">
            <h1 className="text-display-sm text-ink">{title}</h1>
            {intro && <p>{intro}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  )
}
