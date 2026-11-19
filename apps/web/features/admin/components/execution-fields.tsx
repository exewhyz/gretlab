"use client"

import { useQuery } from "@tanstack/react-query"

import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"

import { Field, TextInput } from "@/components/form"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { workExecutionOptions } from "@/features/submissions/execution"

import { useOwner } from "../owner"

type Options = ApiResult<typeof workExecutionOptions>

export interface ExecutionDraft {
  execution: "server" | "browser"
  /** As typed; empty for the platform's limit. */
  perMinute: string
}

/**
 * Where an assignment's or contest's code runs, and how often a student may submit. The
 * server checks both again on save (packages/judge/src/execution.ts).
 */
export function ExecutionFields({
  value,
  onChange,
  error,
}: {
  value: ExecutionDraft
  onChange: (next: ExecutionDraft) => void
  error?: string
}) {
  const owner = useOwner()
  const { data } = useQuery({
    queryKey: ["execution-options", owner.orgSlug],
    queryFn: () =>
      api<Options>(
        `/execution/options${owner.orgSlug ? `?org=${owner.orgSlug}` : ""}`
      ),
    staleTime: 60_000,
  })
  const browserBlocked = data?.browserAllowed ?? null
  return (
    <div
      className="grid gap-3 rounded-md border border-hairline p-3"
      data-testid="execution-settings"
    >
      <div className="grid gap-1">
        <span className="text-body-sm font-medium text-ink">
          Where code runs
        </span>
        <RadioGroup
          value={value.execution}
          onValueChange={(v) =>
            onChange({ ...value, execution: v === "browser" ? "browser" : "server" })
          }
          className="gap-2"
        >
          <label className="inline-flex items-start gap-2 text-body-sm text-ink">
            <RadioGroupItem value="server" aria-label="On the server" />
            <span>
              On the server: every language, graded in the sandbox.
              {data && !data.serverOn && (
                <span className="block text-caption text-destructive">
                  Server execution is off right now, so students can only run
                  code in their browser and can&apos;t submit until it&apos;s
                  back.
                </span>
              )}
            </span>
          </label>
          <label className="inline-flex items-start gap-2 text-body-sm text-ink">
            <RadioGroupItem
              value="browser"
              aria-label="In the browser"
              disabled={browserBlocked !== null && value.execution !== "browser"}
            />
            <span>
              In the students&apos; browsers: Python and JavaScript only.
              <span className="block text-caption text-body">
                Every test&apos;s input is sent to the student&apos;s browser
                and the server checks the output. Results are provisional and
                the server judges them again once it can. Use it when the
                server is failing.
              </span>
              {browserBlocked && (
                <span className="block text-caption text-destructive">
                  {browserBlocked}
                </span>
              )}
            </span>
          </label>
        </RadioGroup>
        {value.execution === "browser" && (
          <p
            role="note"
            className="rounded-md bg-canvas-soft px-2 py-1.5 text-caption text-ink"
          >
            Only Python and JavaScript are offered to students. Problems that
            allow neither can&apos;t be solved here.
          </p>
        )}
      </div>
      <Field
        label="Submissions per student per minute"
        help={
          data
            ? `Empty uses the platform's limit (${data.platformPerMinute}). You can set a lower one, not a higher one.`
            : "Empty uses the platform's limit. You can set a lower one, not a higher one."
        }
      >
        <TextInput
          type="number"
          min={1}
          max={data?.platformPerMinute}
          value={value.perMinute}
          placeholder={data ? String(data.platformPerMinute) : ""}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange({ ...value, perMinute: event.target.value })}
        />
      </Field>
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** The form's draft from what was saved. */
export const executionDraft = (stored?: {
  execution?: "server" | "browser"
  submissionsPerMinute?: number | null
}): ExecutionDraft => ({
  execution: stored?.execution ?? "server",
  perMinute:
    stored?.submissionsPerMinute == null ? "" : String(stored.submissionsPerMinute),
})

/** What the API takes. */
export const executionInput = (draft: ExecutionDraft) => ({
  execution: draft.execution,
  submissionsPerMinute:
    draft.perMinute.trim() === "" ? null : Number(draft.perMinute),
})
