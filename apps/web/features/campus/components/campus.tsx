"use client"

import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { campusOf } from "@/features/campus/server"
import { formatDay } from "@/lib/format"

export interface CampusLoan {
  id: string
  title: string
  author: string
  dueOn: string
  status: "out" | "overdue" | "returned" | "lost"
}

export interface CampusRide {
  route: string
  vehicle: string
  driver: string
  driverPhone: string
  stop: string
  pickup: string
  drop: string
}

export type CampusData = ApiResult<typeof campusOf>

export interface CampusStay {
  hostel: string
  warden: string
  wardenPhone: string
  room: string
  floor: string
  bed: string
  since: string
}

/** Library books (and later bus and hostel) for one person in one organization. */
export function CampusSummary({
  data,
  slug,
  own,
}: {
  data: CampusData
  slug: string
  /** Their own (links to the library page); a parent sees it without links. */
  own: boolean
}) {
  const ride = data.transport?.ride
  const stay = data.hostel?.stay
  if (!data.library && !ride && !stay) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="campus">
      {ride && (
        <div
          className="rounded-lg border border-hairline bg-card p-4"
          data-testid="campus-bus"
        >
          <h3 className="mb-1 text-title-sm text-ink">Bus</h3>
          <p className="text-body-sm text-ink">
            {ride.route}, from {ride.stop}
          </p>
          <p className="text-xs text-body">
            {[
              ride.pickup && `Pick-up ${ride.pickup}`,
              ride.drop && `drop-off ${ride.drop}`,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
          {(ride.vehicle || ride.driver) && (
            <p className="text-xs text-body">
              {[ride.vehicle, ride.driver, ride.driverPhone]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      )}
      {stay && (
        <div
          className="rounded-lg border border-hairline bg-card p-4"
          data-testid="campus-hostel"
        >
          <h3 className="mb-1 text-title-sm text-ink">Hostel</h3>
          <p className="text-body-sm text-ink">
            {stay.hostel}, room {stay.room}, bed {stay.bed}
          </p>
          <p className="text-xs text-body">
            {[stay.floor && `Floor ${stay.floor}`, `since ${stay.since}`]
              .filter(Boolean)
              .join(", ")}
          </p>
          {stay.warden && (
            <p className="text-xs text-body">
              Warden{" "}
              {[stay.warden, stay.wardenPhone].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      )}
      {data.library && (
        <LibraryCard loans={data.library.loans} slug={slug} own={own} />
      )}
    </div>
  )
}

function LibraryCard({
  loans,
  slug,
  own,
}: {
  loans: CampusLoan[]
  slug: string
  own: boolean
}) {
  return (
    <div className="rounded-lg border border-hairline bg-card p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-title-sm text-ink">Library</h3>
        {own && (
          <Link
            href={orgPages(slug).books}
            className="text-caption text-body hover:text-ink"
          >
            Browse
          </Link>
        )}
      </div>
      {loans.length === 0 ? (
        <p className="text-body-sm text-body">No books out.</p>
      ) : (
        <ul className="grid gap-1 text-body-sm" aria-label="Books out">
          {loans.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate text-ink">{l.title}</span>
              <span
                className={cn(
                  "shrink-0 text-xs",
                  l.status === "overdue" ? "text-destructive" : "text-body"
                )}
              >
                {l.status === "overdue"
                  ? `Overdue since ${formatDay(l.dueOn)}`
                  : `Due ${formatDay(l.dueOn)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
