import type { Metadata } from "next"
import type { ReactNode } from "react"

// Organizations' pages are private (AGENTS.md › Search engines): search engines are told not to
// index any of them. A page's own metadata sets its title and keeps this.
export const metadata: Metadata = { robots: { index: false, follow: true } }

export default function OrgsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children
}
