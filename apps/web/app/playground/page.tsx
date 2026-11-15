import type { Metadata } from "next"

import { Playground } from "@/features/lab/components/playground"
import { pageMetadata } from "@/lib/seo/metadata"

// Title and description: lib/seo/config.ts.
export const generateMetadata = (): Promise<Metadata> => pageMetadata("playground")

export default function PlaygroundPage() {
  return (
    <>
      {/* The page's heading for search engines and screen readers; the editor is its visual top. */}
      <h1 className="sr-only">Code playground</h1>
      <Playground />
    </>
  )
}
