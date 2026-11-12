"use client"

import { XIcon } from "@phosphor-icons/react"
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

import { ConfirmButton } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { api } from "@/lib/api/client"

interface Subject {
  id: string
  name: string
  code: string
  description: string
  classes: {
    id: string
    groupId: string
    group: string
    teacher: { id: string; name: string } | null
    canChange: boolean
  }[]
}

interface Data {
  can: { create: boolean; edit: boolean; delete: boolean; assign: boolean }
  levels: string[]
  choosable: string[]
  groups: { id: string; name: string; parentId: string | null }[]
  subjects: Subject[]
}

/** Manage › Subjects: the subjects taught, and which classes take each and who teaches it. */
export function ManageSubjects({ slug }: { slug: string }) {
  const key = ["org", slug, "subjects"]
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Data>(`/orgs/${slug}/subjects`),
  })
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const [editing, setEditing] = useState<Subject | "new" | null>(null)
  const [assigning, setAssigning] = useState<Subject | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/subjects/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  const unassign = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/subjects/classes/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle
        action={
          data.can.create && (
            <Button onClick={() => setEditing("new")}>Add subject</Button>
          )
        }
      >
        Subjects
      </PageTitle>
      {data.subjects.length === 0 ? (
        <p className="text-body-sm text-body">
          No subjects yet.
          {data.can.create &&
            " Add the subjects your classes take, then put each on its classes."}
        </p>
      ) : (
        <div data-testid="subjects">
          <Table headers={["Subject", "Taught in", ""]}>
            {data.subjects.map((s) => (
              <tr
                key={s.id}
                data-testid="subject-row"
                className="border-b border-hairline align-top last:border-0"
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium">
                    {s.name}
                    {s.code && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-body">
                        {s.code}
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <div className="text-caption">{s.description}</div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {s.classes.length === 0 ? (
                    <span className="text-caption">No class yet</span>
                  ) : (
                    <ul className="grid gap-1">
                      {s.classes.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center gap-1.5 text-body-sm"
                        >
                          <span>{c.group}</span>
                          <span className="text-caption">
                            · {c.teacher?.name ?? "no teacher yet"}
                          </span>
                          {c.canChange && (
                            <button
                              type="button"
                              aria-label={`Take ${s.name} off ${c.group}`}
                              className="rounded p-0.5 text-body hover:bg-muted"
                              onClick={() => unassign.mutate(c.id)}
                            >
                              <XIcon className="size-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {data.can.assign && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => setAssigning(s)}
                    >
                      Add to a class
                    </Button>
                  )}
                  {data.can.edit && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditing(s)}
                    >
                      Edit
                    </Button>
                  )}
                  {data.can.delete && (
                    <ConfirmButton
                      size="xs"
                      variant="ghost"
                      title={`Delete ${s.name}?`}
                      description="It comes off every class that takes it. This can't be undone."
                      confirmLabel="Delete subject"
                      onConfirm={() => remove.mutate(s.id)}
                    >
                      Delete
                    </ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {editing && (
        <SubjectDialog
          slug={slug}
          subject={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
      {assigning && (
        <AssignDialog
          slug={slug}
          data={data}
          subject={assigning}
          onDone={() => {
            setAssigning(null)
            void refresh()
          }}
        />
      )}
    </>
  )
}

function SubjectDialog({
  slug,
  subject,
  onDone,
}: {
  slug: string
  subject: Subject | null
  onDone: () => void
}) {
  const [form, setForm] = useState({
    name: subject?.name ?? "",
    code: subject?.code ?? "",
    description: subject?.description ?? "",
  })
  const save = useMutation({
    mutationFn: () =>
      subject
        ? api(`/orgs/${slug}/subjects/${subject.id}`, {
            method: "PUT",
            body: form,
          })
        : api(`/orgs/${slug}/subjects`, { body: form }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {subject ? `Edit ${subject.name}` : "Add a subject"}
          </DialogTitle>
          <DialogDescription>
            Classes take subjects; a timetable schedules them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Mathematics"
            />
          </Field>
          <Field
            label="Code (optional)"
            help="A short code shown in timetables, like MATH."
          >
            <TextInput
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Field>
          <Field label="Description (optional)">
            <TextArea
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !form.name.trim()}
            onClick={() => save.mutate()}
          >
            {subject ? "Save" : "Add subject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssignDialog({
  slug,
  data,
  subject,
  onDone,
}: {
  slug: string
  data: Data
  subject: Subject
  onDone: () => void
}) {
  const [groupId, setGroupId] = useState("")
  const [teacherId, setTeacherId] = useState("")
  const teachers = useQuery({
    queryKey: ["org", slug, "subjects", "teachers", groupId],
    queryFn: () =>
      api<{ id: string; name: string }[]>(
        `/orgs/${slug}/subjects/teachers?groupId=${groupId}`
      ),
    enabled: Boolean(groupId),
  })
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/subjects/${subject.id}/classes`, {
        body: { groupId, teacherId: teacherId || null },
      }),
    onSuccess: onDone,
  })
  const existing = subject.classes.find((c) => c.groupId === groupId)
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {subject.name} to a class</DialogTitle>
          <DialogDescription>
            Choose the class, and who teaches the subject there.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Class">
            <GroupPicker
              label="Class"
              groups={data.groups}
              levels={data.levels}
              value={groupId}
              onChange={(id) => {
                setGroupId(id)
                setTeacherId("")
              }}
              placeholder="Choose a class"
              isDisabled={(id) => !data.choosable.includes(id)}
            />
          </Field>
          {groupId && (
            <Field
              label="Teacher"
              help={
                existing
                  ? "It's already on this class: this changes its teacher."
                  : undefined
              }
            >
              <SelectInput
                aria-label="Teacher"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
              >
                <option value="">No teacher yet</option>
                {(teachers.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!groupId || save.isPending}
            onClick={() => save.mutate()}
          >
            {existing ? "Save teacher" : "Add to class"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
