"use client"

import { PageHeader } from "@/components/page-header"

import {
  PLAYGROUND_ID,
  QuestionSessionProvider,
} from "../hooks/use-question-session"
import { useLocalStore } from "../lib/local-store"
import { layoutStore } from "../lib/stores"
import type { ProblemSummary } from "../types"
import { EditorPane } from "./editor-pane"
import { EngineStatusIndicator } from "./engine-status"

const QUESTION: ProblemSummary = {
  id: PLAYGROUND_ID,
  title: "Playground",
  level: "easy",
  unit: "",
  unitNo: 0,
  no: 0,
  label: "",
}

/** A free workspace: any language, any files, no problem attached. */
export function Playground() {
  const layout = useLocalStore(layoutStore, (value) => value)
  return (
    <div className="flex flex-col min-[901px]:h-dvh">
      <PageHeader>
        <EngineStatusIndicator className="ml-2 hidden lg:flex" />
      </PageHeader>
      <main className="flex min-h-0 flex-1 flex-col p-4">
        <QuestionSessionProvider question={QUESTION}>
          <EditorPane
            problemHidden={false}
            outputOpen={layout.outputOpen}
            codeHeight={layout.codeHeight}
          />
        </QuestionSessionProvider>
      </main>
    </div>
  )
}
