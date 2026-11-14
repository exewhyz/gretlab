"use client"

import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { ConfirmButton } from "@/components/confirm"
import { FormMessage, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

import { GroupPicker } from "./group-picker"
import { type Group, type Member, type Message } from "./manage-shared"

/*
 * The Groups page: a collapsible tree of an organization's groups (branches, batches,
 * teams), and a panel per group to see, add, move and remove its people. Groups can hold
 * hundreds of people, so the tree starts folded and the panel lists people per group
 * inside, folded too, with search and paging.
 */

export interface GroupPeopleData {
  group: { id: string; name: string }
  /** Last-level groups inside, where people added here go; empty for a last-level group. */
  places: { id: string; path: string }[]
  canAdd: boolean
  canManage: boolean
  people: {
    userId: string
    name: string | null
    email: string
    direct: boolean
    notPlaced: boolean
    in: string[]
  }[]
}

export type Person = GroupPeopleData["people"][number]

export const PAGE = 50

/** The people panel's frame: a dialog on the Groups page, a section on a class page. */
export function PeopleFrame({
  inline,
  onClose,
  title,
  description,
  children,
}: {
  inline: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
}) {
  if (inline) {
    return (
      <section className="grid gap-3 text-body-sm">
        <p className="text-caption text-body">{description}</p>
        {children}
      </section>
    )
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-auto text-body-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-title-md text-ink">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * A group's people, in sections by the group inside it where they sit, each folded and
 * paged so hundreds of people stay manageable. Each person can be moved or removed; ticked
 * people can be moved or removed together. People can be added from the organization.
 */
export function GroupPeople({
  slug,
  groupId,
  groups,
  levels,
  onClose,
  onOpen,
  inline = false,
}: {
  slug: string
  groupId: string
  groups: Group[]
  levels: string[]
  onClose: () => void
  onOpen: (groupId: string) => void
  /** On a class page: shown in place, not as a dialog. */
  inline?: boolean
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [bulkInto, setBulkInto] = useState("")
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  const [shownPerSection, setShownPerSection] = useState<
    Record<string, number>
  >({})
  const [addSearch, setAddSearch] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [message, setMessage] = useState<Message>(null)
  const path = `/orgs/${slug}/groups/${groupId}/members`
  const { data, error } = useQuery({
    queryKey: ["org", slug, "group-people", groupId],
    queryFn: () => api<GroupPeopleData>(path),
  })
  const candidates = useQuery({
    queryKey: ["org", slug, "members", addSearch, "", ""],
    queryFn: () =>
      api<Member[]>(`/orgs/${slug}/members?q=${encodeURIComponent(addSearch)}`),
    enabled: Boolean(data?.canManage),
  })
  const act = useMutation({
    mutationFn: (call: () => Promise<unknown>) => call(),
    onSuccess: () => {
      setSelected([])
      setPicked([])
      setMessage(null)
      void queryClient.invalidateQueries({ queryKey: ["org", slug] })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })

  const name = (id: string) => groups.find((g) => g.id === id)?.name ?? ""
  // Groups inside this one by their path from here, to find a section's group.
  const pathFrom = useMemo(() => {
    const map = new Map<string, string>()
    for (const g of groups) {
      const chain: string[] = []
      let current: Group | undefined = g
      while (current && current.id !== groupId) {
        chain.unshift(current.name)
        current = groups.find((x) => x.id === current!.parentId)
      }
      if (current) map.set(chain.join(" › "), g.id)
    }
    return map
  }, [groups, groupId])

  if (!data) {
    if (inline) return <Loading error={error} />
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle>Loading…</DialogTitle>
          <Loading error={error} />
        </DialogContent>
      </Dialog>
    )
  }

  const query = search.trim().toLowerCase()
  const matches = (p: Person) =>
    !query ||
    p.email.toLowerCase().includes(query) ||
    (p.name ?? "").toLowerCase().includes(query)

  // Sections: people sitting directly in this group, then each group inside.
  const sections = new Map<
    string,
    { label: string; source: string; people: Person[] }
  >()
  for (const p of data.people.filter(matches)) {
    const keys: [string, string, string][] = []
    if (p.direct) {
      keys.push([
        "direct",
        p.notPlaced
          ? `Not placed yet in ${data.group.name}`
          : `In ${data.group.name}`,
        groupId,
      ])
    }
    for (const where of p.in)
      keys.push([where, where, pathFrom.get(where) ?? groupId])
    for (const [key, label, source] of keys) {
      const section = sections.get(key) ?? { label, source, people: [] }
      section.people.push(p)
      sections.set(key, section)
    }
  }
  const sectionList = [...sections.entries()].sort(([a], [b]) =>
    a === "direct" ? -1 : b === "direct" ? 1 : a.localeCompare(b)
  )
  // One section, or a search, shows people straight away.
  const isOpen = (key: string) =>
    sectionList.length === 1 || Boolean(query) || openSections.has(key)
  const visibleIds = sectionList.flatMap(([, s]) =>
    s.people.map((p) => p.userId)
  )
  const allTicked =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const tick = (id: string, on: boolean) =>
    setSelected((cur) =>
      on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)
    )
  const direct = new Set(
    data.people.filter((p) => p.direct).map((p) => p.userId)
  )
  const addable = (candidates.data ?? []).filter(
    (m) => m.status === "active" && !direct.has(m.userId)
  )

  const move = (from: string, into: string, userIds: string[]) =>
    act.mutate(() =>
      api(`/orgs/${slug}/groups/${from}/move`, { body: { into, userIds } })
    )
  const remove = (from: string, userIds: string[]) =>
    act.mutate(() =>
      api(`/orgs/${slug}/groups/${from}/members/remove`, { body: { userIds } })
    )

  return (
    <PeopleFrame
      inline={inline}
      onClose={onClose}
      title={`People in ${data.group.name}`}
      description={`${data.people.length} ${data.people.length === 1 ? "person" : "people"}, in it or in groups inside it.`}
    >
      <FormMessage message={message} />
      <div className="grid gap-5 min-[901px]:grid-cols-[minmax(0,1fr)_300px]">
        <section className="grid content-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              aria-label="Search people in this group"
              placeholder="Search by name or email"
              className="w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {data.canManage && visibleIds.length > 0 && (
              <label className="flex items-center gap-2 text-caption text-body">
                <Checkbox
                  aria-label="Tick everyone shown"
                  checked={allTicked}
                  indeterminate={
                    !allTicked && visibleIds.some((id) => selected.includes(id))
                  }
                  onCheckedChange={(on) =>
                    setSelected(
                      on === true
                        ? [...new Set([...selected, ...visibleIds])]
                        : []
                    )
                  }
                />
                Tick everyone shown
              </label>
            )}
          </div>
          {data.canManage && selected.length > 0 && (
            <div
              data-testid="bulk-bar"
              className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-canvas-soft p-2"
            >
              <span className="text-caption text-ink">
                {selected.length} ticked
              </span>
              <GroupPicker
                label="Move ticked people to"
                placeholder="Move to…"
                heading={`Move ${selected.length} ticked ${selected.length === 1 ? "person" : "people"} out of ${data.group.name} into:`}
                className="w-60"
                groups={groups}
                levels={levels}
                isDisabled={(id) => id === groupId}
                value={bulkInto}
                onChange={setBulkInto}
              />
              <Button
                size="sm"
                disabled={!bulkInto || act.isPending}
                onClick={() => move(groupId, bulkInto, selected)}
              >
                Move
              </Button>
              <ConfirmButton
                size="sm"
                variant="destructive"
                title={`Remove ${selected.length} ${selected.length === 1 ? "person" : "people"} from ${data.group.name}?`}
                description={`They leave ${data.group.name} and every group inside it. They stay members of the organization.`}
                confirmLabel="Remove"
                onConfirm={() => remove(groupId, selected)}
              >
                Remove
              </ConfirmButton>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          )}
          {sectionList.length === 0 && (
            <p className="text-body">
              {query
                ? "Nobody matches."
                : "Nobody yet. Add people from the right."}
            </p>
          )}
          {sectionList.map(([key, section]) => {
            const limit = shownPerSection[key] ?? PAGE
            return (
              <Collapsible
                key={key}
                open={isOpen(key)}
                onOpenChange={(open) =>
                  setOpenSections((cur) => {
                    const next = new Set(cur)
                    if (open) next.add(key)
                    else next.delete(key)
                    return next
                  })
                }
                className="rounded-md border border-hairline"
              >
                <CollapsibleTrigger
                  data-testid="people-section"
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-ink hover:bg-muted"
                >
                  {isOpen(key) ? (
                    <CaretDownIcon className="size-3.5" />
                  ) : (
                    <CaretRightIcon className="size-3.5" />
                  )}
                  <span
                    className={
                      key === "direct" && section.label.startsWith("Not placed")
                        ? "text-primary"
                        : ""
                    }
                  >
                    {section.label}
                  </span>
                  <span className="text-xs text-body">
                    · {section.people.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="grid gap-0.5 border-t border-hairline p-1.5">
                    {section.people.slice(0, limit).map((p) => (
                      <PersonRow
                        key={p.userId}
                        person={p}
                        canManage={data.canManage}
                        ticked={selected.includes(p.userId)}
                        onTick={(on) => tick(p.userId, on)}
                        fromName={name(section.source)}
                        from={section.source}
                        groups={groups}
                        levels={levels}
                        busy={act.isPending}
                        onMove={(into) =>
                          move(section.source, into, [p.userId])
                        }
                        onRemove={() => remove(section.source, [p.userId])}
                      />
                    ))}
                  </ul>
                  {section.people.length > limit && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="ms-2 mb-1.5"
                      onClick={() =>
                        setShownPerSection((cur) => ({
                          ...cur,
                          [key]: limit + PAGE,
                        }))
                      }
                    >
                      Show {Math.min(PAGE, section.people.length - limit)} more
                      of {section.people.length - limit}
                    </Button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </section>
        {data.canManage && (
          <section className="grid content-start gap-2">
            <h3 className="text-caption-upper text-body uppercase">
              Add people
            </h3>
            {data.places.length > 0 && (
              <p data-testid="spread-note" className="text-xs text-body">
                {data.group.name} has groups inside, so people added here join{" "}
                {data.places.length === 1
                  ? data.places[0]!.path
                  : `all ${data.places.length} of them`}
                . To add to just one, open it:
                <span className="mt-1 flex flex-wrap gap-1">
                  {data.places.slice(0, 12).map((p) => (
                    <Button
                      key={p.id}
                      size="xs"
                      variant="outline"
                      onClick={() => onOpen(p.id)}
                    >
                      {p.path}
                    </Button>
                  ))}
                </span>
              </p>
            )}
            <TextInput
              aria-label="Find members to add"
              placeholder="Search members by name or email"
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
            />
            <div className="grid max-h-72 gap-0.5 overflow-auto">
              {addable.slice(0, 200).map((m) => (
                <label
                  key={m.userId}
                  className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-muted"
                >
                  <Checkbox
                    aria-label={`Add ${m.email}`}
                    checked={picked.includes(m.userId)}
                    onCheckedChange={(on) =>
                      setPicked(
                        on === true
                          ? [...picked, m.userId]
                          : picked.filter((x) => x !== m.userId)
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-ink">
                      {m.name ?? m.email}
                    </span>
                    <span className="block truncate text-xs text-body">
                      {m.email}
                    </span>
                  </span>
                </label>
              ))}
              {addable.length === 0 && (
                <p className="text-xs text-body">
                  {addSearch
                    ? "Nobody matches."
                    : "Everyone here is already in this group."}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={picked.length === 0 || act.isPending}
                onClick={() =>
                  act.mutate(() => api(path, { body: { userIds: picked } }))
                }
              >
                Add {picked.length || ""} to {data.group.name}
              </Button>
              {addable.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPicked(addable.map((m) => m.userId))}
                >
                  Select all shown
                </Button>
              )}
            </div>
            <p className="text-xs text-body">
              Not a member yet? Invite them from Invites or Import, straight
              into this group.
            </p>
          </section>
        )}
      </div>
    </PeopleFrame>
  )
}

/** One person in a section: tick, move to another group, or remove from this one. */
export function PersonRow({
  person: p,
  canManage,
  ticked,
  onTick,
  from,
  fromName,
  groups,
  levels,
  busy,
  onMove,
  onRemove,
}: {
  person: Person
  canManage: boolean
  ticked: boolean
  onTick: (on: boolean) => void
  from: string
  fromName: string
  groups: Group[]
  levels: string[]
  busy: boolean
  onMove: (into: string) => void
  onRemove: () => void
}) {
  return (
    <li
      data-testid="group-person"
      className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-muted"
    >
      {canManage && (
        <Checkbox
          aria-label={`Tick ${p.email}`}
          checked={ticked}
          onCheckedChange={(on) => onTick(on === true)}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink">{p.name ?? p.email}</span>
        <span className="block truncate text-xs text-body">{p.email}</span>
      </span>
      {canManage && (
        <>
          <GroupPicker
            label={`Move ${p.email} to`}
            heading={`Move ${p.name ?? p.email} from ${fromName} to:`}
            groups={groups}
            levels={levels}
            isDisabled={(id) => id === from || busy}
            value=""
            onChange={onMove}
            trigger={
              <Button size="xs" variant="ghost" aria-label={`Move ${p.email}`}>
                Move
              </Button>
            }
          />
          <ConfirmButton
            size="xs"
            variant="ghost"
            aria-label={`Remove ${p.email}`}
            title={`Remove ${p.name ?? p.email} from ${fromName}?`}
            description={`They leave ${fromName} and any groups inside it. They stay members of the organization.`}
            confirmLabel="Remove"
            onConfirm={onRemove}
          >
            Remove
          </ConfirmButton>
        </>
      )}
    </li>
  )
}
