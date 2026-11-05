import type { Metadata } from "next"

import { Playground } from "@/features/lab/components/playground"

export const metadata: Metadata = {
  title: "Playground",
  description: "Write and run code in your browser, with multiple files.",
}

export default function PlaygroundPage() {
  return <Playground />
}
