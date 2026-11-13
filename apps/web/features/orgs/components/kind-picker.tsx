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
 * Choosing the kind of a new organization: each kind with what it's for, then what the
 * chosen one decides and a warning that it can't be changed, to be confirmed.
 */
export function KindPicker({
  value,
  onChange,
  confirmed,
  onConfirm,
}: {
  value: OrgType
  onChange: (kind: OrgType) => void
  confirmed: boolean
  onConfirm: (yes: boolean) => void
}) {
  const kind = KINDS[value]
  return (
    <div className="grid gap-3" data-testid="kind-picker">
      <div
        role="radiogroup"
        aria-label="Kind of organization"
        className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-3"
      >
        {ORG_TYPES.map((t) => {
          const I = ICONS[t]
          const on = t === value
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`kind-${t}`}
              onClick={() => {
                onChange(t)
                onConfirm(false)
              }}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors",
                on
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-hairline hover:border-hairline-strong"
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-ink"
                )}
              >
                <I className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-body-sm font-semibold text-ink">
                  {KINDS[t].label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {KINDS[t].description}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div
        className="grid gap-2 rounded-xl border border-hairline bg-canvas-soft p-4"
        data-testid="kind-decides"
      >
        <div className="text-body-sm font-semibold text-ink">
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
        <div
          role="note"
          className="mt-1 flex gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-body-sm text-ink"
        >
          <WarningIcon
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>
            The kind can&apos;t be changed after the organization is created:
            its structure, words and modules depend on it. To be a different
            kind later, a new organization has to be made.
          </span>
        </div>
        <Check
          label={`I understand this will be a ${kind.label.toLowerCase()}, and that can't be changed`}
          checked={confirmed}
          onCheckedChange={onConfirm}
        />
      </div>
    </div>
  )
}
