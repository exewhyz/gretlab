"use client"

import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { RichText } from "@/components/rich-text"
import { useViewer } from "@/features/account/use-viewer"
import { api, ApiRequestError } from "@/lib/api/client"

import styles from "./problem-view.module.scss"

type Stage =
  | { name: "hidden" }
  | { name: "confirming" }
  | { name: "shown"; editorial: string; solution: string }
  | { name: "error"; message: string }

/** Nothing of the editorial is in the page: it's fetched only after the student asks. */
export function SolutionReveal({ slug }: { slug: string }) {
  const { data: viewer } = useViewer()
  const [stage, setStage] = useState<Stage>({ name: "hidden" })

  if (!viewer?.features.showSolutions || !viewer.user) return null

  async function reveal() {
    try {
      const { editorial, solution } = await api<{
        editorial: string
        solution: string
      }>(`/problems/${slug}/solution`)
      setStage({ name: "shown", editorial, solution })
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

  return (
    <div className={styles.solution}>
      {stage.name === "hidden" && (
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => setStage({ name: "confirming" })}
        >
          Show editorial and solution
        </Button>
      )}
      {stage.name === "confirming" && (
        <div className="flex flex-wrap items-center gap-2.5 text-caption">
          <span>Try it yourself first. Show it anyway?</span>
          <Button variant="outline" size="sm" onClick={reveal}>
            Show editorial
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStage({ name: "hidden" })}
          >
            Not yet
          </Button>
        </div>
      )}
      {stage.name === "error" && (
        <p role="alert" className="text-caption text-destructive">
          {stage.message}
        </p>
      )}
      {stage.name === "shown" && (
        <>
          {stage.editorial && (
            <>
              <h2>Editorial</h2>
              <RichText text={stage.editorial} />
            </>
          )}
          {stage.solution && (
            <>
              <h2>Reference solution</h2>
              <pre>{stage.solution}</pre>
              <p className={styles.hint}>
                Other programs that print the same output are also correct.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
