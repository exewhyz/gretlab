"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Button } from "@workspace/ui/components/button"

import { useOwner } from "@/features/admin/owner"
import { api } from "@/lib/api/client"

/**
 * A university's own course or template: whether its affiliated colleges may use it, and the
 * button that changes it. Shown only to people who may share (useOwner().sharesWithColleges).
 */
export function CollegesShareToggle({
  kind,
  item,
  listKey,
}: {
  kind: "course" | "template"
  item: { id: string; title: string; sharing: string }
  listKey: unknown[]
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const shared = item.sharing === "affiliates"
  const change = useMutation({
    mutationFn: () =>
      api(owner.api("/library/affiliates"), {
        body: {
          sharing: shared ? "owner" : "affiliates",
          items: [{ kind, id: item.id }],
        },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: listKey }),
    meta: {
      success: shared
        ? "No longer shared with your colleges."
        : "Shared with your affiliated colleges.",
    },
  })
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{shared ? "Affiliated colleges" : "Ours"}</span>
      <Button
        size="sm"
        variant="ghost"
        disabled={change.isPending}
        aria-label={
          shared
            ? `Stop sharing ${item.title} with colleges`
            : `Share ${item.title} with colleges`
        }
        onClick={() => change.mutate()}
      >
        {shared ? "Stop sharing" : "Share with colleges"}
      </Button>
    </span>
  )
}
