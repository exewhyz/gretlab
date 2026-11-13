"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { api } from "@/lib/api/client"


import type { Group, Member, RunInfo } from "./manage-shared"

/**
 * A group's run dates and lead (a cohort's weeks, a pod's mentor). The lead is chosen
 * from the organization's staff, and is given the instructor role on the group if they
 * don't teach it yet.
 */
export function RunDialog({
  slug,
  group,
  info,
  onClose,
}: {
  slug: string
  group: Group
  info: RunInfo
  onClose: () => void
}) {
  const client = useQueryClient()
  const [startsOn, setStartsOn] = useState(group.startsOn ?? "")
  const [endsOn, setEndsOn] = useState(group.endsOn ?? "")
  const [leadId, setLeadId] = useState(group.lead?.id ?? "")
  const members = useQuery({
    queryKey: ["org", slug, "members", "staff"],
    queryFn: () => api<Member[]>(`/orgs/${slug}/members?status=active`),
    enabled: info.lead,
  })
  // Staff: anyone with a role beyond plain membership.
  const staff = (members.data ?? []).filter(
    (m) => m.status === "active" && m.roles.some((r) => r.systemKey !== "member")
  )
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/groups/${group.id}/run`, {
        method: "PUT",
        body: {
          ...(info.dates ? { startsOn: startsOn || null, endsOn: endsOn || null } : {}),
          ...(info.lead ? { leadId: leadId || null } : {}),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug] })
      onClose()
    },
  })
  const lead = info.leadTerm.toLowerCase()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group.name}</DialogTitle>
          <DialogDescription>
            {info.dates && "When it runs, for its week-by-week progress. "}
            {info.lead &&
              `Its ${lead} sees its progress and runs it; they get the instructor role here if they don't have it.`}
          </DialogDescription>
        </DialogHeader>
        <form
          id="run-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          {info.dates && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <TextInput type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </Field>
              <Field label="Ends">
                <TextInput type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              </Field>
            </div>
          )}
          {info.lead && (
            <Field label={info.leadTerm}>
              <SelectInput value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">No {lead}</option>
                {group.lead && !staff.some((m) => m.userId === group.lead!.id) && (
                  <option value={group.lead.id}>{group.lead.name}</option>
                )}
                {staff.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
        </form>
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="run-form" disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
