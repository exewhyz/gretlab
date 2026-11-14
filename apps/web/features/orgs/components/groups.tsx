"use client"

import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"

import { FormMessage, TextInput } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

import type { createGroup } from "@/features/orgs/server"
import { runLabel } from "@/features/runs/format"
import type { ApiResult } from "@/lib/api/types"
import { GroupPicker } from "./group-picker"
import {
  groupPath,
  treeOrder,
  useGroups,
  type Group,
  type Message,
  type RunInfo,
} from "./manage-shared"
import { RunDialog } from "./run-dialog"

/*
 * The Groups page: a collapsible tree of an organization's groups (branches, batches,
 * teams), and a panel per group to see, add, move and remove its people. Groups can hold
 * hundreds of people, so the tree starts folded and the panel lists people per group
 * inside, folded too, with search and paging.
 */
import { GroupPeople } from "./group-people"
export { GroupPeople } from "./group-people"

export function ManageGroups({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const { data, error } = useGroups(slug)
  const [topName, setTopName] = useState("")
  const [message, setMessage] = useState<Message>(null)
  // The group whose people are open in the panel; a new group opens straight away.
  const [openId, setOpenId] = useState<string | null>(null)
  // Groups showing the groups inside them. Everything starts folded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const save = useMutation({
    mutationFn: (call: () => Promise<unknown>) => call(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", slug] })
      setMessage(null)
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  if (!data) return <Loading error={error} />
  const top = data.levels[0] ?? "Group"
  const groups = data.groups
  const hasInside = (id: string) => groups.some((g) => g.parentId === id)
  const parents = groups.filter((g) => hasInside(g.id)).map((g) => g.id)
  // A group shows when every group above it is unfolded.
  const shown = treeOrder(groups).filter((g) => {
    let parent = g.parentId
    while (parent) {
      if (!expanded.has(parent)) return false
      parent = groups.find((x) => x.id === parent)?.parentId ?? null
    }
    return true
  })
  const toggle = (id: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <>
      <PageTitle>Groups</PageTitle>
      <p className="mb-3 text-caption text-body">
        Levels here: {data.levels.join(" › ")}. Change them in Settings.
      </p>
      {data.canManageAll && (
        <form
          className="mb-4 flex max-w-lg gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!topName.trim()) return
            save.mutate(() =>
              api<ApiResult<typeof createGroup>>(`/orgs/${slug}/groups`, {
                body: { name: topName, parentId: null },
              }).then((created) => {
                setTopName("")
                setOpenId(created.id)
              })
            )
          }}
        >
          <TextInput
            aria-label={`New ${top.toLowerCase()}`}
            placeholder={`New ${top.toLowerCase()}, e.g. ${top === "Branch" ? "CSE" : top === "Team" ? "Platform" : "Spring 2026"}`}
            value={topName}
            onChange={(event) => setTopName(event.target.value)}
          />
          <Button type="submit" disabled={save.isPending}>
            Add {top.toLowerCase()}
          </Button>
        </form>
      )}
      <FormMessage message={message} />
      {/* Above the tree, so folding never hides it. */}
      {groups.some((g) => g.notPlaced > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-caption text-ink">
          Some people sit in a group with groups inside and need a place:
          {groups
            .filter((g) => g.notPlaced > 0)
            .map((g) => (
              <Button
                key={g.id}
                data-testid="not-placed"
                size="xs"
                variant="outline"
                onClick={() => setOpenId(g.id)}
              >
                {groupPath(groups, g.id)}: {g.notPlaced} not placed yet
              </Button>
            ))}
        </div>
      )}
      {parents.length > 0 && (
        <div className="mb-2 flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setExpanded(new Set(parents))}
          >
            Expand all
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setExpanded(new Set())}
          >
            Collapse all
          </Button>
        </div>
      )}
      <Card className="grid gap-0.5 p-2">
        {groups.length === 0 && (
          <p className="p-2 text-body-sm text-body">No groups yet.</p>
        )}
        {shown.map((g) => (
          <GroupRow
            key={g.id}
            slug={slug}
            group={g}
            groups={groups}
            levels={data.levels}
            runInfo={data.run}
            childLevel={data.levels[g.depth + 1] ?? null}
            hasInside={hasInside(g.id)}
            expanded={expanded.has(g.id)}
            onToggle={(open) => toggle(g.id, open)}
            run={(call) => save.mutate(call)}
            busy={save.isPending}
            onOpen={setOpenId}
          />
        ))}
      </Card>
      {openId && groups.some((g) => g.id === openId) && (
        <GroupPeople
          key={openId}
          slug={slug}
          groupId={openId}
          groups={groups}
          levels={data.levels}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
        />
      )}
    </>
  )
}

function GroupRow({
  slug,
  group: g,
  groups,
  levels,
  runInfo,
  childLevel,
  hasInside,
  expanded,
  onToggle,
  run,
  busy,
  onOpen,
}: {
  slug: string
  group: Group
  groups: Group[]
  levels: string[]
  runInfo?: RunInfo
  childLevel: string | null
  hasInside: boolean
  expanded: boolean
  onToggle: (open: boolean) => void
  run: (call: () => Promise<unknown>) => void
  busy: boolean
  onOpen: (groupId: string) => void
}) {
  const [mode, setMode] = useState<"child" | "rename" | null>(null)
  const [text, setText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [running, setRunning] = useState(false)
  const runs = Boolean(
    runInfo && (runInfo.dates || runInfo.lead || runInfo.open)
  )
  return (
    <div
      className="grid gap-1.5 rounded-sm px-2 py-1.5 hover:bg-muted"
      style={{ marginInlineStart: g.depth * 24 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {hasInside ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${g.name}`}
            aria-expanded={expanded}
            onClick={() => onToggle(!expanded)}
          >
            {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
          </Button>
        ) : (
          <span aria-hidden className="w-6" />
        )}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-body-sm font-normal text-ink no-underline hover:underline"
          aria-label={`Open ${g.name}`}
          onClick={() => onOpen(g.id)}
        >
          {g.name}
        </Button>
        <span className="text-xs text-body">
          {g.members} {g.members === 1 ? "member" : "members"}
        </span>
        {g.notPlaced > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {g.notPlaced} not placed yet
          </span>
        )}
        {g.startsOn && g.endsOn && (
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink"
            data-testid="group-run"
          >
            {runLabel(g.startsOn, g.endsOn)}
          </span>
        )}
        {g.open && runInfo?.open && (
          <span
            className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
            data-testid="group-open"
          >
            Open to join
          </span>
        )}
        {g.lead && runInfo && (
          <span className="text-xs text-body" data-testid="group-lead">
            {runInfo.leadTerm}: {g.lead.name}
          </span>
        )}
        <span className="flex-1" />
        {runs && g.canEdit && runInfo && (
          <Button size="xs" variant="ghost" onClick={() => setRunning(true)}>
            {runInfo.dates && runInfo.lead
              ? `Dates & ${runInfo.leadTerm.toLowerCase()}`
              : runInfo.dates
                ? "Dates"
                : runInfo.open
                  ? `${runInfo.leadTerm} & joining`
                  : runInfo.leadTerm}
          </Button>
        )}
        {g.canManage && (
          <>
            {childLevel && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setMode("child")
                  setText("")
                }}
              >
                + {childLevel}
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setMode("rename")
                setText(g.name)
              }}
            >
              Rename
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              Delete
            </Button>
          </>
        )}
      </div>
      {running && runInfo && (
        <RunDialog
          slug={slug}
          group={g}
          info={runInfo}
          onClose={() => setRunning(false)}
        />
      )}
      <DeleteGroupDialog
        slug={slug}
        group={g}
        groups={groups}
        levels={levels}
        open={deleting}
        onOpenChange={setDeleting}
        run={run}
        busy={busy}
      />
      {mode && (
        <form
          className="flex max-w-md gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!text.trim()) return
            run(() =>
              mode === "child"
                ? api<ApiResult<typeof createGroup>>(`/orgs/${slug}/groups`, {
                    body: { name: text, parentId: g.id },
                  }).then((created) => {
                    // Show the new group, and its people (or the parent's, if any wait).
                    onToggle(true)
                    onOpen(created.parentNotPlaced > 0 ? g.id : created.id)
                  })
                : api(`/orgs/${slug}/groups/${g.id}`, {
                    method: "PATCH",
                    body: { name: text, description: g.description },
                  })
            )
            setMode(null)
          }}
        >
          <TextInput
            aria-label={
              mode === "child"
                ? `New ${childLevel?.toLowerCase()} in ${g.name}`
                : `Rename ${g.name}`
            }
            className="py-1"
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button size="xs" type="submit">
            {mode === "child" ? "Add" : "Save"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            type="button"
            onClick={() => setMode(null)}
          >
            Cancel
          </Button>
        </form>
      )}
    </div>
  )
}

/**
 * Deleting a group. An empty one just asks to confirm. One with people offers three ways:
 * move them to another group first, empty it (keeping the group), or delete it and take
 * them out of it, which moves nobody anywhere.
 */
function DeleteGroupDialog({
  slug,
  group: g,
  groups,
  levels,
  open,
  onOpenChange,
  run,
  busy,
}: {
  slug: string
  group: Group
  groups: Group[]
  levels: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  run: (call: () => Promise<unknown>) => void
  busy: boolean
}) {
  const [into, setInto] = useState("")
  const base = `/orgs/${slug}/groups/${g.id}`
  const inside = new Set<string>([g.id])
  for (const x of treeOrder(groups)) {
    if (x.parentId && inside.has(x.parentId)) inside.add(x.id)
  }
  const close = () => onOpenChange(false)
  const people = g.members

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {g.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {people === 0
              ? `Nobody is in it. Deleting removes ${g.name} and any groups inside it.`
              : `${g.name} has ${people} ${people === 1 ? "person" : "people"} in it. Choose what happens to them.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {people > 0 && (
          <div className="grid gap-4 text-body-sm">
            <section className="grid gap-2 rounded-md border border-hairline p-3">
              <div className="font-semibold text-ink">
                Move them, then delete
              </div>
              <p className="text-xs text-body">
                They join the group you pick (all its groups inside, if it has
                any).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <GroupPicker
                  label="Move them to"
                  placeholder="Move them to…"
                  heading={`Where ${g.name}'s people go. Groups inside ${g.name} can't be picked.`}
                  className="w-64"
                  groups={groups}
                  levels={levels}
                  isDisabled={(id) => inside.has(id)}
                  value={into}
                  onChange={setInto}
                />
                <Button
                  size="sm"
                  disabled={!into || busy}
                  onClick={() => {
                    run(async () => {
                      await api(`${base}/move`, { body: { into } })
                      await api(base, { method: "DELETE" })
                    })
                    close()
                  }}
                >
                  Move and delete
                </Button>
              </div>
            </section>
            <section className="grid gap-2 rounded-md border border-hairline p-3">
              <div className="font-semibold text-ink">Empty it</div>
              <p className="text-xs text-body">
                Takes everyone out and keeps {g.name}, empty, for later.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                disabled={busy}
                onClick={() => {
                  run(() => api(`${base}/empty`, { body: {} }))
                  close()
                }}
              >
                Empty {g.name}
              </Button>
            </section>
            <section className="grid gap-2 rounded-md border border-destructive/40 p-3">
              <div className="font-semibold text-ink">
                Delete and take them out
              </div>
              <p className="text-xs text-body">
                They leave {g.name} and the groups inside it, aren&apos;t moved
                anywhere, and stay members of the organization.
              </p>
              <Button
                size="sm"
                variant="destructive"
                className="justify-self-start"
                disabled={busy}
                onClick={() => {
                  run(() => api(`${base}?force=true`, { method: "DELETE" }))
                  close()
                }}
              >
                Delete and take them out
              </Button>
            </section>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {people === 0 && (
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                run(() => api(base, { method: "DELETE" }))
                close()
              }}
            >
              Delete
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
