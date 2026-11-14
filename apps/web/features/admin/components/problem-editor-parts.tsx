"use client"

import { type ReactNode } from "react"

import {
  starterFromSolution,
  type LanguageId,
  type ProblemCode,
} from "@workspace/judge"
import { Button } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { ConfirmButton } from "@/components/confirm"
import { Field, TextArea } from "@/components/form"

/**
 * Starter code and reference solution for each language the problem allows.
 * All optional: with none, students start from the language's blank file and write a
 * whole program.
 */
export function LanguageCode({
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
export function EditorSection({
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
export function GenerateStarter({
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
