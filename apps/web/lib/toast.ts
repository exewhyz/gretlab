"use client"

/**
 * Short notices in the corner: a save that worked, an action that failed. Forms still show
 * their own messages beside the button; toasts are for actions with nowhere else to say so.
 * Mutations can pass `meta: { success: "…" }` to announce themselves (components/query-provider).
 */
export { toast } from "@workspace/ui/components/sonner"
