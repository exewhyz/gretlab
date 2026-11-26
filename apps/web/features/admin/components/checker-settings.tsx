"use client"

import {
  CHECKER_CODE_CHARS,
  describeChecker,
  LANGUAGE_IDS,
  LANGUAGES,
  type Checker,
  type LanguageId,
} from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"

import { SelectInput, TextArea, TextInput } from "@/components/form"

/** A checker to start from, per language: compares values, and says where they differ. */
const EXAMPLES: Partial<Record<LanguageId, string>> = {
  python: `# input.txt: the test's input. output.txt: what the student printed.
# answer.txt: the expected output (one correct answer).
# Exit 0 if right, 1 if wrong. Partly right: print a share from 0 to 1, then exit 3.
import sys

expected = open("answer.txt").read().split()
got = open("output.txt").read().split()

if got == expected:
    sys.exit(0)
print(f"Expected {len(expected)} values, got {len(got)}")
sys.exit(1)
`,
  javascript: `// input.txt: the test's input. output.txt: what the student printed.
// answer.txt: the expected output (one correct answer).
// Exit 0 if right, 1 if wrong. Partly right: print a share from 0 to 1, then exit 3.
const fs = require("fs")
const words = (f) => fs.readFileSync(f, "utf8").split(/\s+/).filter(Boolean)

const expected = words("answer.txt")
const got = words("output.txt")
if (got.join(" ") === expected.join(" ")) process.exit(0)
console.log(\`Expected \${expected.length} values, got \${got.length}\`)
process.exit(1)
`,
  cpp: `// input.txt: the test's input. output.txt: what the student printed.
// answer.txt: the expected output (one correct answer).
// Exit 0 if right, 1 if wrong. Partly right: print a share from 0 to 1, then exit 3.
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
using namespace std;

vector<string> words(const char* file) {
  ifstream in(file);
  vector<string> all;
  string w;
  while (in >> w) all.push_back(w);
  return all;
}

int main() {
  auto expected = words("answer.txt"), got = words("output.txt");
  if (got == expected) return 0;
  cout << "Expected " << expected.size() << " values, got " << got.size() << "\n";
  return 1;
}
`,
}

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
  const program = c.program
  if (program)
    return (
      <fieldset className="grid gap-2.5" data-testid="checker-settings">
        <legend className="mb-1 text-caption font-semibold text-ink">
          How output is checked
        </legend>
        <Mode program onChange={(p) => !p && onChange(null)} />
        <p className="text-xs">
          Your program reads <code>input.txt</code> (the test&apos;s input),{" "}
          <code>output.txt</code> (what the student printed) and{" "}
          <code>answer.txt</code> (the expected output), and exits <b>0</b> if
          the answer is right, <b>1</b> if it&apos;s wrong, or <b>3</b> after
          printing a share from 0 to 1 for partly right (that share of the
          test&apos;s points, in whole points). Anything else it prints is shown
          to staff, and to students on samples. It runs in its own sandbox,
          never the student&apos;s, for at most 10 seconds a test. Grading in
          the browser is off for this problem.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            Language
            <SelectInput
              aria-label="Checker language"
              value={program.language}
              onChange={(e) =>
                onChange({
                  program: {
                    ...program,
                    language: e.target.value as LanguageId,
                  },
                })
              }
              className="w-56"
            >
              {LANGUAGE_IDS.map((id) => (
                <option key={id} value={id}>
                  {LANGUAGES[id].label}
                </option>
              ))}
            </SelectInput>
          </label>
          {EXAMPLES[program.language] && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({
                  program: {
                    ...program,
                    code: EXAMPLES[program.language]!,
                  },
                })
              }
            >
              Start from an example
            </Button>
          )}
        </div>
        <TextArea
          mono
          aria-label="Checker code"
          rows={14}
          maxLength={CHECKER_CODE_CHARS}
          value={program.code}
          onChange={(e) =>
            onChange({ program: { ...program, code: e.target.value } })
          }
        />
        <p className="text-xs" data-testid="checker-note">
          Students read: “{note}”
        </p>
      </fieldset>
    )
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
      <Mode
        program={false}
        onChange={(p) =>
          p &&
          onChange({
            program: { language: "python", code: EXAMPLES.python! },
          })
        }
      />
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

/** Compare with the expected output, or let a program decide. */
function Mode({
  program,
  onChange,
}: {
  program: boolean
  onChange: (program: boolean) => void
}) {
  return (
    <RadioGroup
      value={program ? "program" : "compare"}
      onValueChange={(v) => onChange(v === "program")}
      className="flex flex-wrap gap-x-5 gap-y-1.5"
    >
      {(
        [
          ["compare", "Compare with the expected output"],
          ["program", "A checker program decides"],
        ] as const
      ).map(([v, label]) => (
        <label
          key={v}
          className="flex items-center gap-2 text-body-sm text-ink"
        >
          <RadioGroupItem value={v} aria-label={label} />
          {label}
        </label>
      ))}
    </RadioGroup>
  )
}
