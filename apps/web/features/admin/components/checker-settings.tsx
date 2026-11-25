"use client"

import { describeChecker, type Checker } from "@workspace/judge"
import { useState } from "react"

import { Checkbox } from "@workspace/ui/components/checkbox"

import { TextInput } from "@/components/form"

/**
 * How a problem's output is checked (packages/judge/src/checker.ts): exact by default, or any
 * combination of the built-in comparers. Shows the line students will read.
 */
export function CheckerSettings({
  value,
  onChange,
}: {
  value: Checker | null
  onChange: (checker: Checker | null) => void
}) {
  const c = value ?? {}
  // Tolerances as typed, so "0." or "1e-" can be on the way to a number.
  const [absolute, setAbsolute] = useState(
    c.numbers?.absolute !== undefined ? String(c.numbers.absolute) : ""
  )
  const [relative, setRelative] = useState(
    c.numbers?.relative !== undefined ? String(c.numbers.relative) : ""
  )
  const update = (next: Checker) => {
    const cleaned: Checker = {}
    if (next.spacing) cleaned.spacing = true
    if (next.numbers) cleaned.numbers = next.numbers
    if (next.unordered) cleaned.unordered = true
    if (next.ignoreCase) cleaned.ignoreCase = true
    onChange(Object.keys(cleaned).length ? cleaned : null)
  }
  const tolerances = (abs: string, rel: string): Checker["numbers"] => {
    const a = abs.trim() === "" ? undefined : Number(abs)
    const r = rel.trim() === "" ? undefined : Number(rel)
    return {
      ...(a !== undefined && Number.isFinite(a) ? { absolute: a } : {}),
      ...(r !== undefined && Number.isFinite(r) ? { relative: r } : {}),
    }
  }
  const note = describeChecker(value)
  const option = (
    key: "spacing" | "unordered" | "ignoreCase",
    label: string,
    help: string
  ) => (
    <label className="flex items-start gap-2 text-body-sm text-ink">
      <Checkbox
        checked={Boolean(c[key])}
        onCheckedChange={(checked) => update({ ...c, [key]: checked })}
      />
      <span>
        {label}
        <span className="block text-xs text-body">{help}</span>
      </span>
    </label>
  )
  return (
    <fieldset className="grid gap-2.5" data-testid="checker-settings">
      <legend className="mb-1 text-caption font-semibold text-ink">
        How output is checked
      </legend>
      <p className="text-xs">
        Leave everything off to compare exactly (trailing spaces and blank lines
        at the end never matter). Tick what this problem allows; they combine.
      </p>
      {option(
        "spacing",
        "Ignore spacing",
        "Compared value by value: spaces and line breaks between values don't matter."
      )}
      <div className="grid gap-1.5">
        <label className="flex items-start gap-2 text-body-sm text-ink">
          <Checkbox
            checked={Boolean(c.numbers)}
            onCheckedChange={(checked) =>
              update({
                ...c,
                numbers: checked
                  ? tolerances(absolute || "1e-6", relative)
                  : undefined,
              })
            }
            onClick={() => {
              if (!c.numbers && !absolute) setAbsolute("1e-6")
            }}
          />
          <span>
            Numbers within a tolerance
            <span className="block text-xs text-body">
              Numbers are read as numbers, so 2.5E+3 matches 2500. Words stay
              exact.
            </span>
          </span>
        </label>
        {c.numbers && (
          <div className="ml-6 flex flex-wrap gap-3">
            <label className="grid gap-1 text-xs">
              Absolute
              <TextInput
                className="w-32"
                aria-label="Absolute tolerance"
                placeholder="e.g. 1e-6"
                value={absolute}
                onChange={(e) => {
                  setAbsolute(e.target.value)
                  update({
                    ...c,
                    numbers: tolerances(e.target.value, relative),
                  })
                }}
              />
            </label>
            <label className="grid gap-1 text-xs">
              Relative
              <TextInput
                className="w-32"
                aria-label="Relative tolerance"
                placeholder="e.g. 1e-9"
                value={relative}
                onChange={(e) => {
                  setRelative(e.target.value)
                  update({
                    ...c,
                    numbers: tolerances(absolute, e.target.value),
                  })
                }}
              />
            </label>
          </div>
        )}
      </div>
      {option(
        "unordered",
        "Lines in any order",
        "The same lines, each as often as expected, in any order."
      )}
      {option(
        "ignoreCase",
        "Ignore case",
        "YES and yes count as the same. Only words: numbers are never affected."
      )}
      <p className="text-xs" data-testid="checker-note">
        {note ? <>Students read: “{note}”</> : "Exact comparison."}
      </p>
    </fieldset>
  )
}
