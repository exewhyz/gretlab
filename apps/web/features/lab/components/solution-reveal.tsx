"use client"

import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { Markdown } from "@/components/markdown"
import { useQuestionSession } from "@/features/lab/hooks/use-question-session"
import { api, ApiRequestError } from "@/lib/api/client"

interface Solution {
  language: string
  label: string
  code: string
}

type Stage =
  | { name: "hidden" }
  | { name: "loading" }
  | { name: "shown"; editorial: string; solutions: Solution[] }
  | { name: "error"; message: string }

/** Whether this problem has an editorial tab for this viewer. */
export function useHasEditorial() {
  const { detail, viewer } = useQuestionSession()
  return Boolean(viewer?.features.showSolutions && detail?.hasSolution)
}

/**
 * The editorial and reference solutions, in their own tab beside Notes. Nothing of them is
 * in the page: they're fetched only after the student asks, since they spoil the problem.
 */
export function EditorialPanel() {
  const { question, viewer, language } = useQuestionSession()
  const [stage, setStage] = useState<Stage>({ name: "hidden" })

  if (!viewer?.user) {
    return (
      <div className="p-5 text-body-sm text-body">
        Sign in to read the editorial.
      </div>
    )
  }

  async function reveal() {
    setStage({ name: "loading" })
    try {
      const { editorial, solutions } = await api<{
        editorial: string
        solutions: Solution[]
      }>(`/problems/${question.id}/solution`)
      setStage({ name: "shown", editorial, solutions })
    } catch (error) {
      setStage({
        name: "error",
        message:
          error instanceof ApiRequestError
            ? error.message
            : "Couldn't load the editorial.",
      })
    }
  }

  if (stage.name === "hidden" || stage.name === "loading") {
    return (
      <div
        className="grid justify-items-start gap-3 p-5"
        data-testid="editorial-gate"
      >
        <h2 className="text-title-sm text-ink">Editorial</h2>
        <p className="text-body-sm text-body">
          How to approach this problem, with reference solutions. It gives the
          answer away: try it yourself first.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={stage.name === "loading"}
          onClick={reveal}
        >
          Show the editorial
        </Button>
      </div>
    )
  }
  if (stage.name === "error") {
    return (
      <p role="alert" className="p-5 text-body-sm text-ink">
        {stage.message}
      </p>
    )
  }

  const first =
    stage.solutions.find((s) => s.language === language?.id)?.language ??
    stage.solutions[0]?.language
  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-auto p-5"
      data-testid="editorial"
    >
      {stage.editorial && (
        <section className="grid gap-2 text-body-sm text-ink">
          <h2 className="text-title-sm">Editorial</h2>
          <Markdown text={stage.editorial} />
        </section>
      )}
      {stage.solutions.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-title-sm text-ink">Reference solution</h2>
          <Tabs defaultValue={first} className="min-w-0">
            {stage.solutions.length > 1 && (
              <TabsList variant="line" className="max-w-full overflow-x-auto">
                {stage.solutions.map((s) => (
                  <TabsTrigger key={s.language} value={s.language}>
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            {stage.solutions.map((s) => (
              <TabsContent
                key={s.language}
                value={s.language}
                className="min-w-0"
              >
                <div className="relative">
                  <CopyButton text={s.code} />
                  <pre className="overflow-auto rounded-md border border-hairline bg-muted p-3 pe-16 font-mono text-[13px] leading-5 text-ink [font-variant-ligatures:none]">
                    {s.code}
                  </pre>
                </div>
              </TabsContent>
            ))}
          </Tabs>
          <p className="text-caption text-body">
            Other programs that print the same output are also correct.
          </p>
        </section>
      )}
    </div>
  )
}

/** Sits on the code, so it has its own solid background to stay readable over it. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="xs"
      variant="outline"
      className="absolute end-2 top-2 z-10 bg-card shadow-sm hover:bg-muted"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}
