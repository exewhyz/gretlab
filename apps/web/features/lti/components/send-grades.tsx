"use client"

import { useMutation, useQuery } from "@tanstack/react-query"

import { Button } from "@workspace/ui/components/button"

import { FormMessage } from "@/components/form"
import { useOwner } from "@/features/admin/owner"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { orgGradeTargets, orgSendGrades } from "@/features/lti/org"

/** In a college's gradebook: send everyone's totals to the LMS courses that link here. */
export function SendGrades({ id }: { id: string }) {
  const owner = useOwner()
  const { data } = useQuery({
    queryKey: owner.key("assignment", id, "lti"),
    queryFn: () =>
      api<ApiResult<typeof orgGradeTargets>>(
        owner.api(`/assignments/${id}/lti-grades`)
      ),
    enabled: owner.orgSlug !== null,
  })
  const send = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof orgSendGrades>>(
        owner.api(`/assignments/${id}/lti-grades`),
        { body: {} }
      ),
  })
  if (!data || data.targets.length === 0) return null
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-card px-4 py-3 text-body-sm"
      data-testid="send-grades"
    >
      <span className="flex-1 text-body">
        Linked from{" "}
        {data.targets
          .map((t) => `${t.lms}${t.title ? ` (${t.title})` : ""}`)
          .join(", ")}
        .
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={send.isPending}
        onClick={() => send.mutate()}
      >
        Send grades to LMS
      </Button>
      {send.data && (
        <FormMessage
          message={{
            text: `Sent ${send.data.sent}.${send.data.skipped ? ` ${send.data.skipped} haven't opened it from the LMS yet, so it doesn't know them.` : ""}${send.data.failed.length ? ` The LMS refused ${send.data.failed.length}.` : ""}`,
            kind: send.data.failed.length ? "err" : "ok",
          }}
        />
      )}
      {send.error && (
        <FormMessage message={{ text: send.error.message, kind: "err" }} />
      )}
    </div>
  )
}
