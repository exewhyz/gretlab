"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { HostelDialog, ImportResidents } from "./hostel-dialogs"
import { Setup } from "./hostel-parts"
import { AddRoomsDialog, HostelRooms } from "./hostel-rooms"

/** Manage › Hostel: pick a hostel, see its rooms and beds; allot, move out, edit in dialogs. */
export function ManageHostel({ slug }: { slug: string }) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "hostel"],
    queryFn: () => api<Setup>(`/orgs/${slug}/hostel`),
  })
  const [chosen, setChosen] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    "add" | "edit" | "rooms" | "import" | null
  >(null)
  if (!data) return <Loading error={error} />
  const hostel = data.hostels.find((h) => h.id === chosen) ?? data.hostels[0]
  const refresh = () => client.invalidateQueries({ queryKey: ["org", slug] })
  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap gap-2">
            {data.can.allot && data.hostels.length > 0 && (
              <Button variant="outline" onClick={() => setDialog("import")}>
                Allot from a list
              </Button>
            )}
            {data.can.rooms && (
              <Button onClick={() => setDialog("add")}>Add hostel</Button>
            )}
          </div>
        }
      >
        Hostel
      </PageTitle>
      {data.hostels.length === 0 ? (
        <p className="text-body-sm text-body">
          {data.can.rooms ? "Add a hostel, then its rooms." : "No hostels yet."}
        </p>
      ) : (
        <>
          <div
            className="mb-4 flex flex-wrap gap-2"
            role="tablist"
            aria-label="Hostels"
          >
            {data.hostels.map((h) => (
              <button
                key={h.id}
                type="button"
                role="tab"
                aria-selected={h.id === hostel?.id}
                onClick={() => setChosen(h.id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-body-sm",
                  h.id === hostel?.id
                    ? "border-ink bg-card"
                    : "border-hairline hover:border-ink/30"
                )}
              >
                <div className="font-medium text-ink">{h.name}</div>
                <div className="text-xs text-body">
                  {h.taken} of {h.beds} beds taken
                </div>
              </button>
            ))}
          </div>
          {hostel && (
            <HostelRooms
              key={hostel.id}
              slug={slug}
              hostel={hostel}
              can={data.can}
              onEdit={() => setDialog("edit")}
              onAddRooms={() => setDialog("rooms")}
              onChange={refresh}
            />
          )}
        </>
      )}
      {(dialog === "add" || (dialog === "edit" && hostel)) && (
        <HostelDialog
          slug={slug}
          hostel={dialog === "edit" ? hostel! : null}
          onDone={(id) => {
            setDialog(null)
            if (id) {
              setChosen(id)
              void refresh()
            }
          }}
        />
      )}
      {dialog === "rooms" && hostel && (
        <AddRoomsDialog
          slug={slug}
          hostel={hostel}
          onDone={(changed) => (setDialog(null), changed && void refresh())}
        />
      )}
      {dialog === "import" && (
        <ImportResidents
          slug={slug}
          onDone={(changed) => (setDialog(null), changed && void refresh())}
        />
      )}
    </>
  )
}
