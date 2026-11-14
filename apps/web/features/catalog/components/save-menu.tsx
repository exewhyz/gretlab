"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { getMembership } from "@/features/catalog/server"

type Membership = ApiResult<typeof getMembership>[number]

/** Save to favorites or any of the student's lists, as on the problem pages of LeetCode. */
export function SaveMenu({ problemSlug }: { problemSlug: string }) {
  const { data: viewer } = useViewer()
  const queryClient = useQueryClient()
  const key = ["membership", problemSlug]
  const enabled = Boolean(viewer?.user && viewer.features.lists)
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<Membership[]>(`/problems/${problemSlug}/lists`),
    enabled,
  })
  const toggle = useMutation({
    mutationFn: (list: Membership) =>
      api(`/lists/${list.slug}/items`, {
        method: "PUT",
        body: { problemSlug, member: !list.contains },
      }),
    onMutate: (list) =>
      queryClient.setQueryData<Membership[]>(key, (current) =>
        current?.map((item) =>
          item.slug === list.slug ? { ...item, contains: !item.contains } : item
        )
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ["lists"] })
    },
  })

  if (!enabled) return null
  const favorite = data?.find((item) => item.kind === "favorites")

  return (
    <div className="inline-flex items-center gap-1">
      {favorite && (
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={favorite.contains}
          title={
            favorite.contains ? "Remove from favorites" : "Add to favorites"
          }
          onClick={() => toggle.mutate(favorite)}
        >
          {favorite.contains ? "★ Favorited" : "☆ Favorite"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="xs" />}>
          Save to list ▾
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {data
            ?.filter((item) => item.kind !== "favorites")
            .map((item) => (
              <DropdownMenuCheckboxItem
                key={item.slug}
                checked={item.contains}
                onCheckedChange={() => toggle.mutate(item)}
              >
                {item.title}
              </DropdownMenuCheckboxItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/lists" />}>
            New list or manage lists →
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
