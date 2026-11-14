"use client"

import { ErrorView } from "@/components/error-view"

// A page that can't be shown here: no access, not found, or a failure.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorView error={error} reset={reset} />
}
