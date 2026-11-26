"use client"

import {
  BuildingsIcon,
  ChalkboardTeacherIcon,
  GraduationCapIcon,
  RocketLaunchIcon,
  SquaresFourIcon,
  StudentIcon,
  UsersThreeIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react"
import { KINDS, ORG_TYPES, type OrgType } from "@workspace/judge"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { Check } from "@/components/form"

const ICONS: Record<OrgType, Icon> = {
  school: StudentIcon,
  college: GraduationCapIcon,
  coaching: ChalkboardTeacherIcon,
  cohort: RocketLaunchIcon,
  company: BuildingsIcon,
  community: UsersThreeIcon,
  other: SquaresFourIcon,
}

/**
 * Choosing the kind of a new organization: each kind with what it's for, then what the chosen
 * one decides (its groups, words and features). Confirming that it can't be changed comes at
 * the end of the flow (KindConfirm).
 */
export function KindPicker({
  value,
  onChange,
}: {
  value: OrgType
  onChange: (kind: OrgType) => void
}) {
  const kind = KINDS[value]
  return (
    <div className="grid gap-4" data-testid="kind-picker">
      <div
        role="radiogroup"
        aria-label="Kind of organization"
        className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-3"
      >
        {ORG_TYPES.map((t) => {
          const I = ICONS[t]
          const on = t === value
          return (
            <Button
              key={t}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={on}
              data-testid={`kind-${t}`}
              onClick={() => onChange(t)}
              className={cn(
                "h-auto items-start justify-start gap-3 rounded-lg p-3 text-left whitespace-normal",
                on && "border-ink bg-card ring-1 ring-ink hover:bg-card"
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md",
                  on ? "bg-ink text-canvas" : "bg-muted text-ink"
                )}
              >
                <I className="size-4" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="text-body-sm font-semibold text-ink">
                  {KINDS[t].label}
                </span>
                <span className="text-caption font-normal text-muted-foreground">
                  {KINDS[t].description}
                </span>
              </span>
            </Button>
          )
        })}
      </div>
      <div
        className="grid gap-2 rounded-lg bg-card p-4 ring-1 ring-foreground/10"
        data-testid="kind-decides"
      >
        <div className="text-title-sm text-ink">
          A {kind.label.toLowerCase()} works like this
        </div>
        <div className="text-caption text-muted-foreground">
          For example: {kind.examples}
        </div>
        <ul className="grid list-disc gap-1 pl-5 text-body-sm text-body">
          {kind.decides.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <div className="text-caption text-muted-foreground">
          People are called {kind.terms.learners.toLowerCase()} and{" "}
          {kind.terms.instructors.toLowerCase()}; groups are{" "}
          {kind.terms.groups.toLowerCase()} ({kind.groupLevels.join(" › ")}).
        </div>
        <p className="flex gap-2 text-caption text-body">
          <WarningIcon
            className="mt-0.5 size-4 shrink-0 text-chart-4"
            aria-hidden="true"
          />
          The kind can&apos;t be changed after the organization is created.
        </p>
      </div>
    </div>
  )
}

/**
 * The last step's confirmation: the kind can't be changed later, ticked before creating.
 */
export function KindConfirm({
  kind,
  confirmed,
  onConfirm,
}: {
  kind: OrgType
  confirmed: boolean
  onConfirm: (yes: boolean) => void
}) {
  const label = KINDS[kind].label.toLowerCase()
  return (
    <div
      role="note"
      className="grid gap-3 rounded-lg bg-card p-4 ring-1 ring-foreground/10"
      data-testid="kind-confirm"
    >
      <p className="flex gap-2 text-body-sm text-ink">
        <WarningIcon
          className="mt-0.5 size-4 shrink-0 text-chart-4"
          aria-hidden="true"
        />
        <span>
          The kind can&apos;t be changed after the organization is created: its
          structure, words and features depend on it. To be a different kind
          later, a new organization has to be made.
        </span>
      </p>
      <Check
        label={`I understand this will be a ${label}, and that can't be changed`}
        checked={confirmed}
        onCheckedChange={onConfirm}
      />
    </div>
  )
}

/** One line of a review: what was chosen, and its value. */
export function ReviewRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1 border-b border-hairline py-2.5 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-body-sm break-words text-ink">{children}</dd>
    </div>
  )
}
