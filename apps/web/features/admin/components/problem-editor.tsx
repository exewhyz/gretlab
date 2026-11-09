"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import {
  starterFromSolution,
  statementToMarkdown,
  type LanguageId,
  type ProblemCode,
} from "@workspace/judge"

import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { ConfirmButton } from "@/components/confirm"
import { useViewer } from "@/features/account/use-viewer"
import { usePythonEngine } from "@/features/lab/hooks/use-python-engine"
import { MarkdownEditor } from "@/components/markdown-editor"
import { slugify, type ProblemInput } from "@/features/problems/schemas"
import { api } from "@/lib/api/client"
import { useOwner } from "@/features/admin/owner"

import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle } from "./shell"

type TestDraft = ProblemInput["tests"][number] & { key: number }

/** Where a new problem's statement starts. */
const DESCRIPTION_TEMPLATE = `Describe the task: what the program reads, and what it prints.
`

const toLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

const EMPTY: ProblemInput = {
  slug: "",
  title: "",
  unitId: null,
  level: "easy",
  description: DESCRIPTION_TEMPLATE,
  statement: [],
  inputFormat: [],
  outputFormat: [],
  constraints: [],
  solution: "",
  code: {},
  editorial: "",
  hints: [],
  tags: [],
  timeLimitMs: null,
  memoryLimitMb: null,
  allowedLanguages: null,
  published: false,
  membersOnly: false,
  listed: true,
  tests: [{ input: "", expected: "", isSample: true, points: 1 }],
}

/** A problem written inside an assignment, exam or contest form: ready, and not in the library. */
export const ASSESSMENT_PROBLEM: Partial<ProblemInput> = {
  published: true,
  listed: false,
}

/**
 * Writing a problem without leaving an assignment or contest form. It's saved for this
 * owner, kept out of the library, and handed back to be added.
 */
export function NewProblemDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (problem: { id: string; title: string }) => void
}) {
  const owner = useOwner()
  const list = useQuery({
    queryKey: owner.key("problems"),
    queryFn: () => api<StaffProblemList>(owner.api("/problems")),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Write a problem</DialogTitle>
          <DialogDescription>
            It belongs to this assignment or contest: students reach it only through
            work that uses it, never in the problem library.
          </DialogDescription>
        </DialogHeader>
        {list.data ? (
          <ProblemEditor
            id={null}
            initial={{ ...EMPTY, ...ASSESSMENT_PROBLEM }}
            units={list.data.units}
            onSaved={(saved) => {
              onCreated(saved)
              onOpenChange(false)
            }}
          />
        ) : (
          <Loading error={list.error} />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ProblemEditorPage({ id }: { id: string | null }) {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("problem", id),
    queryFn: () => api<ProblemInput>(owner.api(`/problems/${id}`)),
    enabled: id !== null,
  })
  const list = useQuery({
    queryKey: owner.key("problems"),
    queryFn: () => api<StaffProblemList>(owner.api("/problems")),
  })
  if ((id && !data) || !list.data) {
    return <Loading error={error ?? list.error} />
  }
  return (
    <ProblemEditor
      key={id ?? "new"}
      id={id}
      initial={data ?? EMPTY}
      units={list.data.units}
    />
  )
}

function ProblemEditor({
  id,
  initial,
  units,
  onSaved,
}: {
  id: string | null
  initial: ProblemInput
  units: StaffProblemList["units"]
  /** Embedded in another form: hand the new problem back instead of opening its page. */
  onSaved?: (problem: { id: string; title: string }) => void
}) {
  const owner = useOwner()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: viewer } = useViewer()
  const [inputFormat, setInputFormat] = useState(initial.inputFormat.join("\n"))
  const [outputFormat, setOutputFormat] = useState(
    initial.outputFormat.join("\n")
  )
  const [constraints, setConstraints] = useState(initial.constraints.join("\n"))
  const [form, setForm] = useState(() => ({
    ...initial,
    // Problems from before markdown get theirs made from the old fields.
    description: initial.description || statementToMarkdown(initial.statement),
  }))
  const [slugTouched, setSlugTouched] = useState(false)
  const [tagText, setTagText] = useState(initial.tags.join(", "))
  const [hintText, setHintText] = useState(initial.hints.join("\n\n"))
  const [nextKey, setNextKey] = useState(initial.tests.length)
  const [tests, setTests] = useState<TestDraft[]>(() =>
    initial.tests.map((test, key) => ({
      input: test.input,
      expected: test.expected,
      isSample: test.isSample,
      points: test.points,
      key,
    }))
  )
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const [newUnit, setNewUnit] = useState("")

  // Filling expected outputs runs the reference solution locally, in Python only.
  const [useEngine, setUseEngine] = useState(false)
  const engine = usePythonEngine(useEngine)

  const set = <K extends keyof ProblemInput>(key: K, value: ProblemInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const updateTest = (key: number, change: Partial<TestDraft>) =>
    setTests((current) =>
      current.map((test) => (test.key === key ? { ...test, ...change } : test))
    )

  const python = form.code.python ?? {}
  async function fillOutputs() {
    if (!python.solution?.trim()) {
      setMessage({
        text: "Write a Python reference solution first.",
        kind: "err",
      })
      return
    }
    setUseEngine(true)
    setMessage({ text: "Running the solution in Python…" })
    let errors = 0
    for (const test of tests) {
      const result = await engine.run(
        [{ path: "main.py", content: python.solution }],
        "main.py",
        test.input
      )
      if (result.err) errors += 1
      else updateTest(test.key, { expected: result.out.replace(/\n+$/, "") })
    }
    setMessage(
      errors
        ? { text: `${errors} test(s) raised an error.`, kind: "err" }
        : { text: "Expected outputs filled from the solution.", kind: "ok" }
    )
  }

  const save = useMutation({
    mutationFn: () => {
      const body: ProblemInput = {
        ...form,
        // Everything is in `code` now; the old single field would bring back a deleted
        // Python solution.
        solution: "",
        // The markdown statement replaces the older blocks.
        statement: [],
        inputFormat: toLines(inputFormat),
        outputFormat: toLines(outputFormat),
        constraints: toLines(constraints),
        tags: tagText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        hints: hintText
          .split(/\n\s*\n/)
          .map((hint) => hint.trim())
          .filter(Boolean),
        tests: tests.map(({ input, expected, isSample, points }) => ({
          input,
          expected,
          isSample,
          points,
        })),
      }
      return id
        ? api<{ id: string }>(owner.api(`/problems/${id}`), {
            method: "PUT",
            body,
          })
        : api<{ id: string }>(owner.api("/problems"), { body })
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      setMessage({ text: "Saved.", kind: "ok" })
      if (onSaved) onSaved({ id: saved.id, title: form.title })
      else if (!id) router.push(owner.page(`/problems/${saved.id}`))
    },
    onError: (error) => setMessage({ text: error.message, kind: "err" }),
  })

  const remove = useMutation({
    mutationFn: () => api(owner.api(`/problems/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      router.push(owner.page("/problems"))
    },
    onError: (error) => setMessage({ text: error.message, kind: "err" }),
  })

  const addUnit = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/admin/units", { body: { name: newUnit } }),
    onSuccess: (unit) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "problems"] })
      set("unitId", unit.id)
      setNewUnit("")
    },
  })

  return (
    <>
      {!onSaved && <PageTitle>{id ? "Edit problem" : "New problem"}</PageTitle>}
      <Card className="grid gap-4">
        <div className="grid gap-3 min-[901px]:grid-cols-[2fr_1fr_1fr]">
          <Field label="Title">
            <TextInput
              value={form.title}
              onChange={(event) => {
                set("title", event.target.value)
                if (!id && !slugTouched)
                  set("slug", slugify(event.target.value))
              }}
            />
          </Field>
          <Field label="Address" help="Part of the page's URL. Keep it stable.">
            <TextInput
              value={form.slug}
              placeholder="electricity-bill"
              onChange={(event) => {
                setSlugTouched(true)
                set("slug", event.target.value)
              }}
            />
          </Field>
          <Field label="Level">
            <SelectInput
              className="capitalize"
              value={form.level}
              onChange={(event) =>
                set("level", event.target.value as ProblemInput["level"])
              }
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </SelectInput>
          </Field>
        </div>

        {/* Units are the platform's course outline; organizations' problems stand alone. */}
        {!owner.orgSlug && (
          <div className="grid gap-3 min-[901px]:grid-cols-[1fr_1fr]">
            <Field label="Unit">
              <SelectInput
                value={form.unitId ?? ""}
                onChange={(event) => set("unitId", event.target.value || null)}
              >
                <option value="">No unit</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Or create a unit">
              <div className="flex gap-2">
                <TextInput
                  value={newUnit}
                  onChange={(event) => setNewUnit(event.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto"
                  disabled={!newUnit.trim()}
                  onClick={() => addUnit.mutate()}
                >
                  Add
                </Button>
              </div>
            </Field>
          </div>
        )}

        <EditorSection
          title="Problem statement"
          help="The task, in markdown. Input format, output format and constraints go in their own boxes below, and samples come from the test cases."
        >
          <MarkdownEditor
            label="Problem statement"
            value={form.description}
            onChange={(text) => set("description", text)}
            rows={12}
          />
        </EditorSection>
        <div className="grid gap-3 min-[901px]:grid-cols-3">
          <Field
            label="Input format"
            help="One bullet per line. `backticks` for code."
          >
            <TextArea
              rows={4}
              placeholder={"Line 1: an integer `n`\nLine 2: `n` numbers"}
              value={inputFormat}
              onChange={(event) => setInputFormat(event.target.value)}
            />
          </Field>
          <Field label="Output format" help="One bullet per line.">
            <TextArea
              rows={4}
              placeholder="One line: the answer"
              value={outputFormat}
              onChange={(event) => setOutputFormat(event.target.value)}
            />
          </Field>
          <Field label="Constraints" help="One bullet per line.">
            <TextArea
              rows={4}
              placeholder="1 ≤ `n` ≤ 100"
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
            />
          </Field>
        </div>
        <LanguageCode
          languages={(viewer?.languages ?? []).filter(
            (l) =>
              !form.allowedLanguages || form.allowedLanguages.includes(l.id)
          )}
          value={form.code}
          onChange={(code) => set("code", code)}
        />
        <Field
          label="Topic tags"
          help="Comma-separated, such as Loops, Strings. Students filter problems by these."
        >
          <TextInput
            value={tagText}
            placeholder="Loops, Strings"
            onChange={(event) => setTagText(event.target.value)}
          />
        </Field>
        <Field
          label="Hints"
          help="A blank line between hints. Students reveal them one at a time, so start gentle."
        >
          <TextArea
            rows={4}
            value={hintText}
            onChange={(event) => setHintText(event.target.value)}
          />
        </Field>
        <EditorSection
          title="Editorial"
          help="How to approach it. Shown in the Editorial tab with the reference solutions, under the same rules."
        >
          <MarkdownEditor
            label="Editorial"
            value={form.editorial}
            onChange={(text) => set("editorial", text)}
            rows={10}
          />
        </EditorSection>

        <div className="grid gap-3 min-[901px]:grid-cols-3">
          <Field
            label="Time limit (ms)"
            help="Empty uses the language's limit."
          >
            <TextInput
              type="number"
              value={form.timeLimitMs ?? ""}
              onChange={(event) =>
                set(
                  "timeLimitMs",
                  event.target.value ? Number(event.target.value) : null
                )
              }
            />
          </Field>
          <Field
            label="Memory limit (MB)"
            help="Empty uses the language's limit."
          >
            <TextInput
              type="number"
              value={form.memoryLimitMb ?? ""}
              onChange={(event) =>
                set(
                  "memoryLimitMb",
                  event.target.value ? Number(event.target.value) : null
                )
              }
            />
          </Field>
          <fieldset className="grid content-start gap-1 text-caption">
            <legend className="mb-1.5 font-semibold text-ink">
              Allowed languages
            </legend>
            {viewer?.languages.map((language) => (
              <label key={language.id} className="flex items-center gap-2">
                <Checkbox
                  checked={
                    !form.allowedLanguages ||
                    form.allowedLanguages.includes(language.id)
                  }
                  onCheckedChange={(checked) => {
                    const all = viewer.languages.map((item) => item.id)
                    const current = form.allowedLanguages ?? all
                    const next: string[] = checked
                      ? [...current, language.id]
                      : current.filter((item) => item !== language.id)
                    set(
                      "allowedLanguages",
                      next.length === all.length ? null : next
                    )
                  }}
                />
                {language.label}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="grid gap-2.5">
          <div>
            <div className="text-caption font-semibold text-ink">
              Test cases
            </div>
            <div className="text-xs">
              Samples are public. All others stay on the server: students only
              see whether they passed.
            </div>
          </div>
          {tests.map((test, index) => (
            <div
              key={test.key}
              className="grid gap-2 rounded-md border border-hairline p-2.5"
            >
              <div className="flex flex-wrap items-center gap-3 text-caption font-semibold text-ink">
                <span>Test {index + 1}</span>
                <label className="inline-flex items-center gap-1.5 font-normal">
                  <Checkbox
                    checked={test.isSample}
                    onCheckedChange={(checked) =>
                      updateTest(test.key, { isSample: checked })
                    }
                  />
                  Sample
                </label>
                <label className="inline-flex items-center gap-1.5 font-normal">
                  Points
                  <TextInput
                    type="number"
                    className="w-20 py-0.5"
                    value={test.points}
                    onChange={(event) =>
                      updateTest(test.key, {
                        points: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setTests((current) =>
                      current.filter((item) => item.key !== test.key)
                    )
                  }
                >
                  Remove
                </Button>
              </div>
              <div className="grid gap-2 min-[901px]:grid-cols-2">
                <TextArea
                  mono
                  rows={3}
                  aria-label={`Test ${index + 1} input`}
                  placeholder="Input"
                  value={test.input}
                  onChange={(event) =>
                    updateTest(test.key, { input: event.target.value })
                  }
                />
                <TextArea
                  mono
                  rows={3}
                  aria-label={`Test ${index + 1} expected output`}
                  placeholder="Expected output"
                  value={test.expected}
                  onChange={(event) =>
                    updateTest(test.key, { expected: event.target.value })
                  }
                />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTests((current) => [
                  ...current,
                  {
                    key: nextKey,
                    input: "",
                    expected: "",
                    isSample: false,
                    points: 1,
                  },
                ])
                setNextKey(nextKey + 1)
              }}
            >
              + Add test
            </Button>
            <Button variant="outline" size="sm" onClick={fillOutputs}>
              Fill expected outputs from the Python solution
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-3.5">
          <label className="inline-flex items-center gap-2 text-ink">
            <Checkbox
              checked={form.published}
              onCheckedChange={(checked) => set("published", checked)}
            />
            {form.listed ? "Published in practice" : "Ready for students"}
          </label>
          <label className="inline-flex items-center gap-2 text-ink">
            <Checkbox
              checked={form.listed}
              onCheckedChange={(checked) => set("listed", checked)}
            />
            Show in the problem library
          </label>
          {owner.orgSlug && form.listed && (
            <label className="inline-flex items-center gap-2 text-ink">
              <Checkbox
                checked={form.membersOnly}
                onCheckedChange={(checked) => set("membersOnly", checked)}
              />
              Only for our members
            </label>
          )}
          <span className="min-w-45 flex-1">
            <FormMessage message={message} />
          </span>
          {id && !onSaved && (
            <ConfirmButton
              variant="destructive"
              title={`Delete ${form.title || "this problem"}?`}
              description="Its tests and statement go for good. Contests and assignments that use it must drop it first. This can't be undone."
              confirmLabel="Delete problem"
              onConfirm={() => remove.mutate()}
            >
              Delete
            </ConfirmButton>
          )}
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </Card>
    </>
  )
}

/**
 * Starter code and reference solution for each language the problem allows.
 * All optional: with none, students start from the language's blank file and write a
 * whole program.
 */
function LanguageCode({
  languages,
  value,
  onChange,
}: {
  languages: { id: string; label: string; starter: string }[]
  value: Record<string, ProblemCode>
  onChange: (code: Record<string, ProblemCode>) => void
}) {
  const setPart = (id: string, part: keyof ProblemCode, text: string) =>
    onChange({ ...value, [id]: { ...value[id], [part]: text } })
  const filled = (id: string) =>
    Object.values(value[id] ?? {}).some((text) => text?.trim())
  if (languages.length === 0) return null
  return (
    <section className="grid gap-2" data-testid="language-code">
      <div>
        <h2 className="text-body-sm font-semibold text-ink">
          Code for each language
        </h2>
        <p className="text-caption text-body">
          All optional. Starter code is what students begin with, as normal code
          they can change: the input reading, or an empty function and the lines
          that call it. The reference solution is a complete program, shown with
          the editorial under the same rules (hidden during a contest that uses
          this problem).
        </p>
      </div>
      <Tabs defaultValue={languages[0]!.id}>
        <TabsList variant="line" className="max-w-full overflow-x-auto">
          {languages.map((l) => (
            <TabsTrigger key={l.id} value={l.id}>
              {l.label}
              {filled(l.id) && (
                <span
                  aria-label="has code"
                  className="size-1.5 rounded-full bg-primary"
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {languages.map((l) => {
          const code = value[l.id] ?? {}
          return (
            <TabsContent key={l.id} value={l.id} className="grid gap-3 pt-2">
              <Field label={`Reference solution (${l.label})`}>
                <TextArea
                  mono
                  rows={8}
                  value={code.solution ?? ""}
                  onChange={(e) => setPart(l.id, "solution", e.target.value)}
                />
              </Field>
              <div className="grid gap-1.5">
                <Field
                  label={`Starter code (${l.label})`}
                  help="Exactly what students begin with, as normal code they can change. Empty uses the language's blank file."
                >
                  <TextArea
                    mono
                    rows={6}
                    placeholder={l.starter}
                    value={code.starter ?? ""}
                    onChange={(e) => setPart(l.id, "starter", e.target.value)}
                  />
                </Field>
                <GenerateStarter
                  label={l.label}
                  hasStarter={Boolean(code.starter?.trim())}
                  solution={code.solution ?? ""}
                  onGenerate={() =>
                    setPart(
                      l.id,
                      "starter",
                      starterFromSolution(
                        l.id as LanguageId,
                        code.solution ?? ""
                      )
                    )
                  }
                />
              </div>
            </TabsContent>
          )
        })}
      </Tabs>
    </section>
  )
}

/** A titled part of the form holding a larger editor (not a single labelled input). */
function EditorSection({
  title,
  help,
  children,
}: {
  title: string
  help?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-1.5">
      <h2 className="text-body-sm font-semibold text-ink">{title}</h2>
      {help && <p className="-mt-1 text-caption text-body">{help}</p>}
      {children}
    </section>
  )
}

/**
 * Fills the starter code from the reference solution: its input reading stays, its logic
 * becomes "Your code here". Asks before replacing starter code that's already there.
 */
function GenerateStarter({
  label,
  hasStarter,
  solution,
  onGenerate,
}: {
  label: string
  hasStarter: boolean
  solution: string
  onGenerate: () => void
}) {
  const text = "Generate from the reference solution"
  const disabled = !solution.trim()
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasStarter ? (
        <ConfirmButton
          size="sm"
          variant="outline"
          disabled={disabled}
          title={`Replace the ${label} starter code?`}
          description="It's made again from the reference solution: the input reading stays, the rest becomes a “Your code here” comment. Your current starter code is replaced."
          confirmLabel="Replace"
          onConfirm={onGenerate}
        >
          {text}
        </ConfirmButton>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onGenerate}
        >
          {text}
        </Button>
      )}
      <span className="text-caption text-body">
        {disabled
          ? "Write the reference solution first."
          : "Keeps how the input is read; the logic becomes “Your code here”. Review it before saving."}
      </span>
    </div>
  )
}
