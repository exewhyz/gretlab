import type { Metadata } from "next"

import { Playground } from "@/features/lab/components/playground"

export const metadata: Metadata = {
  title: "Code playground",
  description:
    "Write and run Python, JavaScript, C, C++ or Java in your browser, with multiple files and a real compiler, no setup needed.",
  alternates: { canonical: "/playground" },
}

export default function PlaygroundPage() {
  return (
    <>
      {/* The page's heading for search engines and screen readers; the editor is its visual top. */}
      <h1 className="sr-only">Code playground</h1>
      <Playground />
    </>
  )
}
