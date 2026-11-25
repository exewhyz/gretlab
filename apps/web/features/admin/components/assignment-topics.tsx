"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { Field, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import type { orgSyllabusTopics } from "@/features/teaching/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

type Syllabi = ApiResult<typeof orgSyllabusTopics>

/**
 * The syllabus topics an assignment covers, chosen from its organization's class syllabi. The
 * classes it's for are listed first. The class page shows each topic's assignments.
 */
export function TopicTagger({
  orgSlug,
  audience,
  chosen,
  onChange,
}: {
  orgSlug: string
  audience: string[][]
  chosen: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const { data, error } = useQuery({
    queryKey: ["org", orgSlug, "syllabus-topics"],
    queryFn: () => api<Syllabi>(`/orgs/${orgSlug}/syllabus-topics`),
    enabled: open || chosen.length > 0,
  })
  const aimed = new Set(audience.flat())
  const query = search.trim().toLowerCase()
  const classes = (data ?? [])
    .map((c) => ({
      ...c,
      topics: c.topics.filter(
        (t) => !query || `${c.group} ${t.title}`.toLowerCase().includes(query)
      ),
    }))
    .filter((c) => c.topics.length > 0)
    .sort((a, b) => Number(aimed.has(b.groupId)) - Number(aimed.has(a.groupId)))
  const titles = (data ?? [])
    .flatMap((c) => c.topics)
    .filter((t) => chosen.includes(t.id))
    .map((t) => t.title)
  return (
    <Field
      label="Syllabus topics"
      help="Which topics this covers; each class's syllabus shows its assignments."
    >
      <div>
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="assignment-topics"
        >
          <span className="text-body-sm text-body">
            {chosen.length === 0
              ? "None chosen"
              : titles.length
                ? titles.join(", ")
                : `${chosen.length} chosen`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setOpen(true)}
          >
            {chosen.length ? "Change" : "Choose topics"}
          </Button>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Syllabus topics it covers</DialogTitle>
              <DialogDescription>
                From the classes&apos; syllabi; the classes it&apos;s for come
                first.
              </DialogDescription>
            </DialogHeader>
            {!data ? (
              <Loading error={error} />
            ) : data.length === 0 ? (
              <p className="text-caption">
                No syllabus yet. A class adds topics under Syllabus and log.
              </p>
            ) : (
              <div className="grid gap-2">
                <TextInput
                  aria-label="Search topics"
                  placeholder="Search topics"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="grid max-h-80 gap-3 overflow-y-auto">
                  {classes.map((c) => (
                    <div key={c.groupId} className="grid gap-1">
                      <div className="text-caption font-medium text-ink">
                        {c.group}
                      </div>
                      {c.topics.map((t) => (
                        <label
                          key={t.id}
                          className="flex items-start gap-2 text-body-sm"
                        >
                          <Checkbox
                            checked={chosen.includes(t.id)}
                            onCheckedChange={(checked) =>
                              onChange(
                                checked
                                  ? [...chosen, t.id]
                                  : chosen.filter((id) => id !== t.id)
                              )
                            }
                          />
                          <span>{t.title}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Field>
  )
}
