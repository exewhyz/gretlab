"use client"

import { BellIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

interface Notices {
  reminders: { id: string; kind: string; title: string; body: string; href: string }[]
  notifications: {
    id: string
    kind: string
    title: string
    body: string
    href: string
    readAt: string | null
    createdAt: string
  }[]
  unread: number
  email: { on: boolean; available: boolean }
}

const KEY = ["me", "notifications"]

/** The header's bell: reminders (due soon, contests, attendance) and what happened. */
export function NotificationBell() {
  const { data: viewer } = useViewer()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api<Notices>("/me/notifications"),
    enabled: Boolean(viewer?.user),
    refetchInterval: 60_000,
  })
  const update = useMutation({
    mutationFn: (body: { read?: "all" | string[]; email?: boolean }) =>
      api("/me/notifications", { method: "PATCH", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
  if (!viewer?.user) return null
  const count = (data?.unread ?? 0) + (data?.reminders.length ?? 0)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={count ? `Notifications, ${count} new` : "Notifications"}
            data-testid="notification-bell"
            className="relative"
          />
        }
      >
        <BellIcon className="size-4.5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="grid w-96 max-w-[calc(100vw-2rem)] grid-cols-[minmax(0,1fr)] gap-0 p-0"
        data-testid="notifications"
      >
        <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
          <span className="text-body-sm font-semibold text-ink">Notifications</span>
          {(data?.unread ?? 0) > 0 && (
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0"
              onClick={() => update.mutate({ read: "all" })}
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[60dvh] overflow-y-auto">
          {data?.reminders.map((r) => (
            <Link
              key={r.id}
              href={r.href}
              data-testid="reminder"
              onClick={() => setOpen(false)}
              className="block border-b border-hairline bg-primary/5 px-3 py-2 hover:bg-primary/10"
            >
              <div className="text-body-sm font-medium text-ink">{r.title}</div>
              <div className="text-caption">{r.body}</div>
            </Link>
          ))}
          {data?.notifications.map((n) => (
            <Link
              key={n.id}
              href={n.href || "#"}
              data-testid="notification"
              onClick={() => {
                if (!n.readAt) update.mutate({ read: [n.id] })
                setOpen(false)
              }}
              className={cn(
                "block border-b border-hairline px-3 py-2 hover:bg-muted",
                !n.readAt && "bg-card"
              )}
            >
              <div
                className={cn(
                  "text-body-sm text-ink",
                  !n.readAt && "font-semibold"
                )}
              >
                {n.title}
              </div>
              {n.body && <div className="line-clamp-2 text-caption">{n.body}</div>}
              <div className="text-xs text-muted-foreground">
                {formatDateTime(n.createdAt)}
              </div>
            </Link>
          ))}
          {data &&
            data.reminders.length === 0 &&
            data.notifications.length === 0 && (
              <p className="px-3 py-6 text-center text-caption">Nothing yet.</p>
            )}
        </div>
        {data?.email.available && (
          <label className="flex items-center gap-2 border-t border-hairline px-3 py-2 text-caption">
            <Checkbox
              checked={data.email.on}
              onCheckedChange={(on) => update.mutate({ email: on })}
            />
            Also email me these
          </label>
        )}
      </PopoverContent>
    </Popover>
  )
}
