"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { FormMessage, SelectInput } from "@/components/form"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { orgFeatures } from "@/features/orgs/kinds"

type Features = ApiResult<typeof orgFeatures>
type Level = "off" | "optional" | "default"

const LEVEL_WORDS: Record<Level, string> = {
  off: "Off",
  optional: "Optional (they choose)",
  default: "On from the start",
}

/**
 * Which modules one organization may have, set by the platform over its kind's policy.
 * "As its kind" follows Admin › Organization kinds.
 */
export function OrgFeaturesDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const key = ["admin", "platform", "org-features", orgId]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Features>(`/admin/organizations/${orgId}/modules`),
    enabled: open,
  })
  const [draft, setDraft] = useState<Record<string, Level | null>>({})
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api<Features>(`/admin/organizations/${orgId}/modules`, {
        method: "PUT",
        body: { modules: draft },
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next)
      setDraft({})
      setMessage({ text: "Saved. It applies at once.", kind: "ok" })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const levelOf = (m: Features["modules"][number]) =>
    m.key in draft ? draft[m.key] : m.level
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDraft({})
          setMessage(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Modules{data ? ` for ${data.org.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            Decide what this organization may use, over what its kind
            {data ? ` (${data.org.kind})` : ""} allows. &ldquo;As its
            kind&rdquo; follows Organization kinds. Optional modules are then
            switched on or off in its own settings.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-body-sm text-destructive">
            {error.message}
          </p>
        )}
        {!data && !error && (
          <p className="text-body-sm text-body">Loading…</p>
        )}
        {data && (
          <ul
            className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1"
            data-testid="org-features"
          >
            {data.modules.map((m) => {
              const level = levelOf(m)
              return (
                <li
                  key={m.key}
                  className="grid gap-2 rounded-md border border-hairline p-2.5 min-[640px]:grid-cols-[1fr_13rem] min-[640px]:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm font-medium text-ink">
                        {m.label}
                      </span>
                      {!m.ready ? (
                        <Badge variant="outline">Coming soon</Badge>
                      ) : m.on ? (
                        <Badge variant="secondary">On now</Badge>
                      ) : null}
                    </div>
                    <p className="text-caption text-body">{m.description}</p>
                  </div>
                  <SelectInput
                    aria-label={`${m.label} for this organization`}
                    disabled={!m.ready}
                    value={level ?? ""}
                    onChange={(e) => {
                      setMessage(null)
                      setDraft((d) => ({
                        ...d,
                        [m.key]: (e.target.value || null) as Level | null,
                      }))
                    }}
                  >
                    <option value="">
                      As its kind ({LEVEL_WORDS[m.kindLevel].toLowerCase()})
                    </option>
                    <option value="off">{LEVEL_WORDS.off}</option>
                    <option value="optional">{LEVEL_WORDS.optional}</option>
                    <option value="default">{LEVEL_WORDS.default}</option>
                  </SelectInput>
                </li>
              )
            })}
          </ul>
        )}
        <DialogFooter className="items-center">
          <span className="flex-1">
            <FormMessage message={message} />
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={save.isPending || Object.keys(draft).length === 0}
            onClick={() => save.mutate()}
          >
            Save modules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
