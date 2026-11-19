"use client"

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

import { toast } from "@/lib/toast"

/** A refusal or a missing thing (403, 404): retrying won't change it. */
function refused(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status
  return status === 403 || status === 404
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Announced as a toast when it works. */
      success?: string
      /** Don't toast its failure: the screen shows it some other way. */
      quiet?: boolean
    }
  }
}

export function makeQueryClient() {
  return new QueryClient({
    // Mutations that don't handle their own failure still tell the person it failed,
    // and those that ask announce success.
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.options.onError || mutation.meta?.quiet) return
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Something went wrong. Please try again."
        )
      },
      onSuccess: (_data, _vars, _ctx, mutation) => {
        if (mutation.meta?.success) toast.success(mutation.meta.success)
      },
    }),
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
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
