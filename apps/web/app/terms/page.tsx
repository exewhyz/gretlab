import type { Metadata } from "next"

import { Terms } from "@/features/legal/components/terms"
import { legalFacts } from "@/features/legal/server"
import { pageMetadata } from "@/lib/seo/metadata"

// Title and description: lib/seo/config.ts. The text: features/legal.
export const generateMetadata = (): Promise<Metadata> => pageMetadata("terms")

export default async function TermsPage() {
  return <Terms facts={await legalFacts()} />
}
