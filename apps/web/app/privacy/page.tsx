import type { Metadata } from "next"

import { PrivacyPolicy } from "@/features/legal/components/privacy-policy"
import { legalFacts } from "@/features/legal/server"
import { pageMetadata } from "@/lib/seo/metadata"

// Title and description: lib/seo/config.ts. The text: features/legal.
export const generateMetadata = (): Promise<Metadata> => pageMetadata("privacy")

export default async function PrivacyPage() {
  return <PrivacyPolicy facts={await legalFacts()} />
}
