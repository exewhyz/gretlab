"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { RichText } from "@/components/rich-text"
import { TextInput } from "@/components/form"
import { Card, Loading, Table } from "@/features/admin/components/shell"
import { useProgress } from "@/features/lab/hooks/use-progress"
import { api } from "@/lib/api/client"

import { Difficulty } from "./difficulty"
import type { ApiResult } from "@/lib/api/types"
import type { getList, getLists } from "@/features/catalog/server"
import type { createList } from "@/features/catalog/server"

type ListSummary = ApiResult<typeof getLists>[number]

type ListDetail = ApiResult<typeof getList>

export function MyLists() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [title, setTitle] = useState("")
  const { data, error } = useQuery({
    queryKey: ["lists"],
    queryFn: () => api<ListSummary[]>("/lists"),
  })
  const create = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof createList>>("/lists", { body: { title } }),
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: ["lists"] })
      router.push(`/lists/${list.slug}`)
    },
  })
  if (!data) return <Loading error={error} />
  const mine = data.filter((list) => list.mine)
  const plans = data.filter((list) => list.kind === "study_plan")
  const row = (list: ListSummary) => (
    <tr key={list.slug}>
      <td>
        <Link href={`/lists/${list.slug}`} className="hover:underline">
          {list.kind === "favorites" ? "★ " : ""}
          {list.title}
        </Link>
      </td>
      <td className="tabular-nums">{list.size}</td>
    </tr>
  )
  return (
    <div className="grid gap-6">
      <section>
        <h1 className="mb-3 text-display-lg text-ink">My lists</h1>
        <Table headers={["List", "Problems"]}>{mine.map(row)}</Table>
        <div className="mt-3 flex max-w-md gap-2">
          <TextInput
            aria-label="New list name"
            placeholder="New list, such as Revision for finals"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            size="sm"
            className="h-auto"
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="mt-1 text-caption text-destructive">
            {create.error.message}
          </p>
        )}
      </section>
      {plans.length > 0 && (
        <section>
          <h2 className="mb-3 text-title-md text-ink">Study plans</h2>
          <Table headers={["Plan", "Problems"]}>{plans.map(row)}</Table>
        </section>
      )}
    </div>
  )
}

export function ListView({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const progress = useProgress()
  const { data, error } = useQuery({
    queryKey: ["list", slug],
    queryFn: () => api<ListDetail>(`/lists/${slug}`),
  })
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/lists/${slug}`, { method: "PATCH", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["list", slug] })
      void queryClient.invalidateQueries({ queryKey: ["lists"] })
    },
  })
  const remove = useMutation({
    mutationFn: () => api(`/lists/${slug}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists"] })
      router.push("/lists")
    },
  })
  if (!data) return <Loading error={error} />

  const solved = data.items.filter(
    (item) => progress[item.slug] === "solved"
  ).length
  const editable = data.mine || data.kind === "study_plan"
  const without = (target: string) =>
    data.items.filter((item) => item.slug !== target).map((item) => item.slug)

  return (
    <div className="grid gap-4 text-body-sm text-body">
      <div>
        <div className="text-caption-upper uppercase">
          {data.kind === "study_plan"
            ? "Study plan"
            : data.kind === "favorites"
              ? "Favorites"
              : "List"}
        </div>
        <h1 className="text-display-lg text-ink">{data.title}</h1>
        {data.description && <RichText text={data.description} />}
      </div>
      <Card>
        <div className="flex justify-between text-caption">
          <span>Progress</span>
          <span data-testid="list-progress" className="tabular-nums">
            {solved} / {data.items.length} solved
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-strong">
          <div
            className="h-full bg-success"
            style={{
              width: `${data.items.length ? (100 * solved) / data.items.length : 0}%`,
            }}
          />
        </div>
      </Card>
      {data.items.length === 0 ? (
        <p>
          Nothing here yet. Open a problem and use <b>Save</b> to add it.
        </p>
      ) : (
        <Table
          headers={["", "Problem", "Difficulty", ...(data.mine ? [""] : [])]}
        >
          {data.items.map((item) => (
            <tr key={item.slug}>
              <td className="w-8">
                {progress[item.slug] === "solved" ? (
                  <span className="text-success">✓</span>
                ) : null}
              </td>
              <td>
                <Link
                  href={`/problems/${item.slug}`}
                  className="hover:underline"
                >
                  {item.title}
                </Link>
              </td>
              <td>
                <Difficulty level={item.level} />
              </td>
              {data.mine && (
                <td className="w-24 text-right">
                  <ConfirmButton
                    variant="ghost"
                    size="xs"
                    title={`Remove ${item.title} from this list?`}
                    description="The problem stays in the library; only this list changes."
                    confirmLabel="Remove"
                    onConfirm={() =>
                      update.mutate({ problemSlugs: without(item.slug) })
                    }
                  >
                    Remove
                  </ConfirmButton>
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
      {data.mine && data.kind === "custom" && editable && (
        <div className="flex gap-2">
          <ConfirmButton
            variant="destructive"
            size="sm"
            title={`Delete ${data.title}?`}
            description="The list goes for good. The problems in it stay in the library."
            confirmLabel="Delete list"
            onConfirm={() => remove.mutate()}
          >
            Delete list
          </ConfirmButton>
        </div>
      )}
    </div>
  )
}
