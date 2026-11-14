"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

/** A refusal or a missing thing (403, 404): retrying won't change it. */
function refused(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status
  return status === 403 || status === 404
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            // A refusal shows at once (Loading turns it into "You don't have access" or
            // "Not found"); only failures that might pass are tried again.
            retry: (failures, error) => !refused(error) && failures < 1,
          },
        },
      })
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
