"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"

import type { CodeEditorHandle } from "@/features/editor/code-editor"
import { EditorSettings } from "@/features/editor/editor-settings"
import { Stopwatch } from "@/features/editor/stopwatch"
import { FileTabs } from "@/features/editor/file-tabs"

import { useQuestionSession } from "../hooks/use-question-session"
import { layoutStore, saveLayout } from "../lib/stores"
import { ResizeHandle } from "./resize-handle"
import { TabButton } from "./tab-button"
import { TestCasesPanel } from "./test-cases-panel"
import { TestResults } from "./test-results"
import styles from "./workbench.module.scss"

const CodeEditor = dynamic(
  () => import("@/features/editor/code-editor").then((m) => m.CodeEditor),
  {
    ssr: false,
    loading: () => (
      <div className="p-3 text-caption text-body">Loading editor…</div>
    ),
  }
)

const MIN_CODE_HEIGHT = 120

export function EditorPane({
  ref,
  problemHidden,
  outputOpen,
  codeHeight,
}: {
  ref?: Ref<HTMLElement>
  problemHidden: boolean
  outputOpen: boolean
  codeHeight: number | null
}) {
  const session = useQuestionSession()
  const {
    question,
    language,
    languages,
    workspace,
    setCode,
    tab,
    openTab,
    runOnce,
    canRun,
    mode,
    submitMode,
    isPlayground,
  } = session
  const signedIn = Boolean(session.viewer?.user)
  const pathname = usePathname()
  const pane = useRef<HTMLElement | null>(null)
  const codeBox = useRef<HTMLDivElement>(null)
  const editor = useRef<CodeEditorHandle | null>(null)

  const [pasteNote, setPasteNote] = useState(false)

  // The toolbar, notices and file tabs depend on the viewer, the problem and where code runs,
  // which arrive a moment after the page. Until they're known the pane stays hidden behind a
  // skeleton, so it appears once at its final size instead of pushing the editor down
  // in steps. A problem that never loads shows the pane anyway after a few seconds.
  const known =
    mode !== "loading" &&
    (Boolean(workspace) ||
      (languages.length === 0 && (isPlayground || Boolean(session.detail))))
  const [waitedEnough, setWaitedEnough] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaitedEnough(true), 4000)
    return () => clearTimeout(timer)
  }, [])
  const settled = known || waitedEnough

  function dragRows(event: PointerEvent) {
    const box = codeBox.current?.getBoundingClientRect()
    const paneRect = pane.current?.getBoundingClientRect()
    if (!box || !paneRect) return
    const height = Math.min(
      paneRect.bottom - box.top - 90,
      Math.max(MIN_CODE_HEIGHT, event.clientY - box.top)
    )
    layoutStore.update((value) => ({
      ...value,
      codeHeight: Math.round(height),
    }))
  }

  function stepRows(direction: -1 | 1) {
    const height = codeBox.current?.getBoundingClientRect().height ?? 0
    saveLayout({
      codeHeight: Math.max(
        MIN_CODE_HEIGHT,
        Math.round(height + direction * 24)
      ),
    })
  }

  const activeFile = workspace?.files.find(
    (file) => file.path === workspace.active
  )
  const codeStyle = codeHeight
    ? ({ "--code-h": `${codeHeight}px` } as CSSProperties)
    : undefined

  return (
    <section
      ref={(node) => {
        pane.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      className={cn(
        styles.editor,
        !outputOpen && styles.outputHidden,
        "relative",
        !settled && "[&>*:not([data-pane-skeleton])]:invisible"
      )}
      aria-label="Code editor"
      aria-busy={!settled}
    >
      {!settled && (
        <div
          data-pane-skeleton
          aria-hidden
          className="absolute inset-0 z-10 flex flex-col gap-3 p-3"
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="w-full flex-1" />
        </div>
      )}
      <div className={styles.editorHead}>
        {problemHidden && !isPlayground && (
          <Button
            variant="ghost"
            size="sm"
            className="max-[900px]:hidden"
            onClick={() => saveLayout({ problemOpen: true })}
          >
            ⇥ Problem
          </Button>
        )}
        <NativeSelect
          size="sm"
          aria-label="Language"
          value={language?.id ?? ""}
          disabled={languages.length < 2}
          onChange={(event) => session.selectLanguage(event.target.value)}
          className="max-w-36 text-caption text-ink has-[select:disabled]:opacity-100"
        >
          {languages.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {item.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span
          className="text-xs text-body"
          title={
            session.viewer?.user && !session.isPlayground
              ? "Saved to your account a moment after you stop typing, so it's there on any computer. For assignment problems your teacher can see it, and how it changed."
              : "Kept in this browser: saved a moment after you stop typing, and whenever you leave or run your code"
          }
        >
          {session.saving ? "Edited" : "Saved"}
        </span>
        <span className="flex-1" />
        <Stopwatch />
        <EditorSettings onReset={() => session.files.reset()} />
        <Button
          variant="ghost"
          size="sm"
          title="Format this file (Shift+Alt+F)"
          onClick={() => editor.current?.format()}
        >
          Format
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canRun}
          title="Run (Ctrl+Enter)"
          onClick={runOnce}
        >
          Run
        </Button>
        {!isPlayground &&
          (mode === "browser" && !signedIn ? (
            <Link
              href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Sign in to submit
            </Link>
          ) : (
            <Button
              size="sm"
              disabled={!session.canSubmit}
              title={
                submitMode === "unavailable"
                  ? "Submitting is paused: the server can't run code right now"
                  : submitMode === "browser"
                    ? "Graded in your browser and checked on the server (provisional)"
                    : undefined
              }
              onClick={session.submitForGrading}
            >
              Submit
            </Button>
          ))}
      </div>

      {mode === "browser" && (
        <div className="flex-none border-b border-hairline bg-canvas-soft px-3 py-1.5 text-xs text-body">
          {signedIn ? (
            submitMode === "browser" ? (
              <>
                Code runs in your browser here (Python and JavaScript). Submit
                is graded in your browser and checked on the server; the result
                is provisional until the server judges it again.
              </>
            ) : (
              <>
                The server can&apos;t run code right now, so Python and
                JavaScript run in your browser. Submitting is paused until
                it&apos;s back.
              </>
            )
          ) : (
            <>
              Running Python and JavaScript in your browser.{" "}
              <Link
                className="underline underline-offset-2 hover:text-ink"
                href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
              >
                Sign in
              </Link>{" "}
              for hidden tests, other languages and contests.
            </>
          )}
        </div>
      )}
      {session.blockedReason && (
        <div
          role="alert"
          className="flex-none border-b border-hairline bg-canvas-soft px-3 py-1.5 text-xs text-body"
        >
          {session.blockedReason}
        </div>
      )}
      {mode === "unavailable" && (
        <div
          role="alert"
          className="flex-none border-b border-hairline bg-canvas-soft px-3 py-1.5 text-xs text-destructive"
        >
          {session.viewer?.user
            ? "Running code is turned off right now."
            : "Sign in to run code."}
        </div>
      )}

      {pasteNote && (
        <div
          role="status"
          className="flex-none border-b border-hairline bg-canvas-soft px-3 py-1.5 text-xs text-ink"
        >
          Pasting is turned off for this contest. Type your code here.
        </div>
      )}
      <FileTabs />

      <div ref={codeBox} className={styles.code} style={codeStyle}>
        {language && workspace && activeFile && (
          <CodeEditor
            modelPrefix={`file:///${question.id}/${language.id}`}
            file={activeFile}
            files={workspace.files}
            language={language.editorLanguage}
            onChange={setCode}
            onRun={runOnce}
            handle={editor}
            blockPaste={Boolean(session.detail?.pasteBlocked)}
            onPasteBlocked={() => setPasteNote(true)}
          />
        )}
      </div>

      <ResizeHandle
        orientation="horizontal"
        label="Resize code and output"
        onDrag={dragRows}
        onDragEnd={layoutStore.persist}
        onStep={stepRows}
        onReset={() => saveLayout({ codeHeight: null })}
      />

      <div className={styles.tabs} role="tablist">
        <TabButton selected={tab === "cases"} onClick={() => openTab("cases")}>
          Test cases
        </TabButton>
        <TabButton
          selected={tab === "result"}
          onClick={() => openTab("result")}
        >
          Result
        </TabButton>
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-1.5 ml-auto"
          title={outputOpen ? "Hide output panel" : "Show output panel"}
          aria-label={outputOpen ? "Hide output panel" : "Show output panel"}
          onClick={() => saveLayout({ outputOpen: !outputOpen })}
        >
          {outputOpen ? "▾" : "▴"}
        </Button>
      </div>

      <div className={styles.panel} role="tabpanel">
        {tab === "cases" ? <TestCasesPanel /> : <TestResults />}
      </div>
    </section>
  )
}
