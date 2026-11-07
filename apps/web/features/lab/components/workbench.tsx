"use client"

import Link from "next/link"
import { useRef, useState, type CSSProperties, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { useExamInProgress } from "@/features/exams/components/exam"
import { cn } from "@workspace/ui/lib/utils"

import { NotesPanel } from "@/features/catalog/components/notes-panel"
import { SubmissionsPanel } from "@/features/submissions/components/submissions-panel"

import { useProgress } from "../hooks/use-progress"
import { QuestionSessionProvider } from "../hooks/use-question-session"
import { useLocalStore } from "../lib/local-store"
import { layoutStore, saveLayout } from "../lib/stores"
import type { ProblemDetail, ProblemSummary, QuestionStatus } from "../types"
import { EditorPane } from "./editor-pane"
import { Notices, type Notice } from "./notices"
import { QuestionList } from "./question-list"
import { ResizeHandle } from "./resize-handle"
import { EditorialPanel, useHasEditorial } from "./solution-reveal"
import { TabButton } from "./tab-button"
import { TopBar } from "./top-bar"
import styles from "./workbench.module.scss"

const clampRatio = (ratio: number) => Math.min(0.75, Math.max(0.25, ratio))

export interface WorkbenchProps {
  questions: ProblemSummary[]
  notices: Notice[]
  /** Given when the page already has it; otherwise fetched. */
  detail?: ProblemDetail
  contestSlug?: string
  blockedReason?: ReactNode
  listTitle?: string
  /** Replaces the practice progress, for a contest's own results. */
  statusOverride?: Record<string, QuestionStatus>
  activeId: string | undefined
  hrefFor: (id: string) => string
  onNavigate: (id: string) => void
  /** Renders the open problem. Given as a slot so it can be server-rendered. */
  children: ReactNode
  banner?: ReactNode
  /** Ad slots. The workbench only decides where they go, never whether they show. */
  sidebarAd?: ReactNode
  pageEndAd?: ReactNode
}

/** The student app shell: top bar, question list, problem, resizable editor. */
export function Workbench({
  questions,
  notices,
  detail,
  contestSlug,
  blockedReason,
  listTitle = "Problems",
  statusOverride,
  activeId,
  hrefFor,
  onNavigate,
  children,
  banner,
  sidebarAd,
  pageEndAd,
}: WorkbenchProps) {
  const current = questions.find((q) => q.id === activeId) ?? questions[0]
  const layout = useLocalStore(layoutStore, (value) => value)
  const practice = useProgress()
  const status = statusOverride ?? practice
  const [leftTab, setLeftTab] = useState<
    "problem" | "editorial" | "notes" | "submissions"
  >("problem")
  // A different problem opens on its statement, never on its editorial.
  const [tabProblem, setTabProblem] = useState(current?.id)
  if (current?.id !== tabProblem) {
    setTabProblem(current?.id)
    setLeftTab("problem")
  }
  const solved = questions.filter((q) => status[q.id] === "solved").length
  const problemPane = useRef<HTMLElement>(null)
  const editorPane = useRef<HTMLElement>(null)

  const ratio = clampRatio(layout.ratio)
  const benchVars = {
    "--prob-fr": `${ratio}fr`,
    "--ed-fr": `${1 - ratio}fr`,
  } as CSSProperties

  function dragColumns(event: PointerEvent) {
    const problem = problemPane.current?.getBoundingClientRect()
    const editor = editorPane.current?.getBoundingClientRect()
    if (!problem || !editor) return
    const next =
      (event.clientX - problem.left - 7) / (editor.right - problem.left - 14)
    layoutStore.update((value) => ({ ...value, ratio: clampRatio(next) }))
  }

  if (!current) {
    return <p className="p-6 text-body-sm text-body">No problems yet.</p>
  }

  return (
    <div className={styles.app}>
      <TopBar
        questions={questions}
        status={status}
        activeId={current.id}
        onNavigate={onNavigate}
      />
      {banner}
      <Notices notes={notices} />

      <main
        className={cn(
          styles.bench,
          !layout.listOpen && styles.listCollapsed,
          !layout.problemOpen && styles.problemCollapsed
        )}
        style={benchVars}
      >
        <nav className={styles.list} aria-label="Problems">
          {layout.listOpen ? (
            <>
              <div className={styles.paneHead}>
                <span className={styles.paneTitle}>{listTitle}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Collapse problem list"
                  aria-label="Collapse problem list"
                  onClick={() => saveLayout({ listOpen: false })}
                >
                  «
                </Button>
              </div>
              <div className={styles.listBody}>
                <QuestionList
                  questions={questions}
                  activeId={current.id}
                  hrefFor={hrefFor}
                  status={status}
                  showUnits={
                    !contestSlug &&
                    !statusOverride &&
                    questions.some((q) => q.unitNo > 0)
                  }
                />
              </div>
              {sidebarAd}
              <div className={styles.listFoot}>
                <span />
                <Link href="/privacy">Privacy</Link>
              </div>
            </>
          ) : (
            <div className={styles.listRail}>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Show problem list"
                aria-label="Show problem list"
                onClick={() => saveLayout({ listOpen: true })}
              >
                »
              </Button>
              <span className={styles.railCount}>
                {solved} / {questions.length}
              </span>
            </div>
          )}
        </nav>

        {/* Keyed so a new question starts with fresh input, output and test results. */}
        <QuestionSessionProvider
          key={current.id}
          question={current}
          detail={detail}
          contestSlug={contestSlug}
          blockedReason={blockedReason}
        >
          <article ref={problemPane} className={styles.problem}>
            <div className={cn(styles.paneHead, "py-0! pl-0!")} role="tablist">
              <TabButton
                selected={leftTab === "problem"}
                className="py-3"
                onClick={() => setLeftTab("problem")}
              >
                Problem
              </TabButton>
              <EditorialTabButton
                problemSlug={current.id}
                selected={leftTab === "editorial"}
                onClick={() => setLeftTab("editorial")}
              />
              <TabButton
                selected={leftTab === "notes"}
                className="py-3"
                onClick={() => setLeftTab("notes")}
              >
                Notes
              </TabButton>
              <TabButton
                selected={leftTab === "submissions"}
                className="py-3"
                onClick={() => setLeftTab("submissions")}
              >
                Submissions
              </TabButton>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="icon-sm"
                className="max-[900px]:hidden"
                title="Hide problem (wide editor)"
                aria-label="Hide problem"
                onClick={() => saveLayout({ problemOpen: false })}
              >
                ⇤
              </Button>
            </div>
            {/* Kept mounted but hidden: this is the server-rendered text of the problem. */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                leftTab !== "problem" && "hidden"
              )}
            >
              {children}
            </div>
            {leftTab === "editorial" && <EditorialPanel />}
            {leftTab === "notes" && <NotesPanel />}
            {leftTab === "submissions" && <SubmissionsPanel />}
          </article>

          <ResizeHandle
            orientation="vertical"
            label="Resize problem and editor"
            onDrag={dragColumns}
            onDragEnd={layoutStore.persist}
            onStep={(direction) =>
              saveLayout({ ratio: clampRatio(ratio + direction * 0.03) })
            }
            onReset={() => saveLayout({ ratio: 0.5 })}
          />

          <EditorPane
            ref={editorPane}
            problemHidden={!layout.problemOpen}
            outputOpen={layout.outputOpen}
            codeHeight={layout.codeHeight}
          />
        </QuestionSessionProvider>
      </main>

      {pageEndAd}
      <footer className={styles.mobileFooter}>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </div>
  )
}

/** Shown only when this problem has an editorial the viewer may read. */
function EditorialTabButton({
  problemSlug,
  selected,
  onClick,
}: {
  problemSlug: string
  selected: boolean
  onClick: () => void
}) {
  const hasEditorial = useHasEditorial()
  // The server refuses it during an exam too; this just doesn't offer it.
  const inExam = useExamInProgress(problemSlug)
  if (!hasEditorial || inExam) return null
  return (
    <TabButton selected={selected} className="py-3" onClick={onClick}>
      Editorial
    </TabButton>
  )
}
