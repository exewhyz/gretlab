"use client"

import { TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { TextInput } from "@/components/form"
import { Loading, Pager } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { useDebounced } from "@/lib/use-debounced"

import type { myUploads } from "@/features/uploads/server"

type Library = ApiResult<typeof myUploads>
export type PickedImage = Library["items"][number]

const PER_PAGE = 24

/**
 * Choosing an image: one you've uploaded before (your images, most recently used first,
 * searched by name), or a new upload. The same image is only ever stored once, so picking an
 * old one costs nothing. `forLogo` shows only PNG and JPEG (what a logo can be).
 */
export function ImagePicker({
  open,
  onOpenChange,
  onPick,
  onUpload,
  forLogo = false,
  title = "Add an image",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (image: PickedImage) => void
  /** Opens the file chooser for a new upload (the caller uploads it). */
  onUpload: () => void
  forLogo?: boolean
  title?: string
}) {
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const q = useDebounced(search.trim())
  const key = ["my-uploads", forLogo, q, page] as const
  const { data, error, isFetching } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<Library>(
        `/me/uploads?page=${page}&perPage=${PER_PAGE}${q ? `&q=${encodeURIComponent(q)}` : ""}${forLogo ? "&for=logo" : ""}`
      ),
    enabled: open,
    placeholderData: keepPreviousData,
  })
  const pick = useMutation({
    mutationFn: (image: PickedImage) =>
      api(`/me/uploads/${image.id}`, { method: "POST" }).then(() => image),
    onSuccess: (image) => {
      void client.invalidateQueries({ queryKey: ["my-uploads"] })
      onPick(image)
      onOpenChange(false)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/me/uploads/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["my-uploads"] }),
    meta: { success: "Removed from your images." },
  })
  const empty = data && data.total === 0 && !q
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="image-picker">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Pick one you&apos;ve used before, or upload a new one.
            {forLogo
              ? " PNG or JPEG, up to 2 MB."
              : " PNG, JPEG, GIF or WebP, up to 2 MB."}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={empty ? "upload" : "mine"} key={empty ? "u" : "m"}>
          <TabsList>
            <TabsTrigger value="mine">Your images</TabsTrigger>
            <TabsTrigger value="upload">Upload new</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="grid gap-3 pt-3">
            <TextInput
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search by file name"
              aria-label="Search your images"
            />
            {!data ? (
              <Loading error={error} />
            ) : data.items.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-body">
                {q
                  ? "No image by that name."
                  : "Nothing here yet: images you upload appear here."}
              </p>
            ) : (
              <ul
                className={cn(
                  "grid grid-cols-3 gap-2 sm:grid-cols-4",
                  isFetching && "opacity-60"
                )}
                data-testid="my-images"
              >
                {data.items.map((image) => (
                  <li key={image.id} className="group relative min-w-0">
                    <Button
                      type="button"
                      variant="ghost"
                      className="grid h-auto w-full gap-1 rounded-lg p-1 ring-1 ring-foreground/10 hover:ring-foreground/30"
                      aria-label={`Use ${image.name || "this image"}`}
                      disabled={pick.isPending}
                      onClick={() => pick.mutate(image)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded image, served by redirect */}
                      <img
                        src={image.url}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full rounded-md bg-muted object-contain"
                      />
                      <span className="truncate text-caption text-body">
                        {image.name || "Untitled"}
                      </span>
                    </Button>
                    <ConfirmButton
                      size="icon-xs"
                      variant="ghost"
                      className="absolute top-1.5 right-1.5 bg-card/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remove ${image.name || "this image"} from your images`}
                      title={`Remove ${image.name || "this image"} from your images?`}
                      description="It stays wherever it's already used; only your list forgets it."
                      confirmLabel="Remove from my images"
                      onConfirm={() => remove.mutate(image.id)}
                    >
                      <TrashIcon aria-hidden />
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            )}
            {data && data.pages > 1 && (
              <Pager
                page={data.page}
                pages={data.pages}
                total={data.total}
                perPage={PER_PAGE}
                onPage={setPage}
              />
            )}
          </TabsContent>
          <TabsContent value="upload" className="pt-3">
            <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-hairline-strong px-4 py-10 text-center">
              <UploadSimpleIcon
                aria-hidden
                className="size-6 text-muted-foreground"
              />
              <p className="text-body-sm text-body">
                The same image is only ever stored once, so uploading one you
                already have just picks it.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  onUpload()
                }}
              >
                Choose a file
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
