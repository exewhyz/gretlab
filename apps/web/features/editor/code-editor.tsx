"use client"

import Editor, { loader, type OnMount } from "@monaco-editor/react"
import type { SourceFile } from "@workspace/judge"
import type * as Monaco from "monaco-editor"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"

import { useLocalStore } from "@/features/lab/lib/local-store"
import { editorPrefsStore } from "@/features/lab/lib/stores"

import {
  lintPython,
  registerLanguageServices,
  setWorkspaceFiles,
} from "./language-services"

// Self-hosted by scripts/copy-vendor.mjs, so it works where CDNs are blocked.
loader.config({ paths: { vs: "/vendor/monaco/vs" } })

const LIGHT = "gretlab-light"
const DARK = "gretlab-dark"

function defineThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme(LIGHT, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#fafaf7",
      "editor.foreground": "#26251e",
      "editorLineNumber.foreground": "#a09c92",
      "editorLineNumber.activeForeground": "#5a5852",
      "editor.lineHighlightBackground": "#efeee8",
      "editorGutter.background": "#fafaf7",
    },
  })
  monaco.editor.defineTheme(DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1e1d18",
      "editor.foreground": "#edece4",
      "editorLineNumber.foreground": "#6f6c62",
      "editorLineNumber.activeForeground": "#b8b5ab",
      "editor.lineHighlightBackground": "#292822",
      "editorGutter.background": "#1e1d18",
    },
  })
}

/** Set once Monaco has loaded in this tab: later editors start it at once. */
let monacoLoaded = false

/**
 * Starts Monaco (about 1 MB) once the page has loaded and the browser is idle, or at once
 * when someone touches the code, so the problem shows first. Until then the code is drawn
 * as plain text in the editor's own font, size and colours, filling the same box.
 */
function useStartWhenIdle() {
  const [live, setLive] = useState(monacoLoaded)
  useEffect(() => {
    if (live) return
    let idle: number | undefined
    let timer: number | undefined
    const start = () => {
      if (typeof window.requestIdleCallback === "function")
        idle = window.requestIdleCallback(() => setLive(true), { timeout: 2000 })
      else timer = window.setTimeout(() => setLive(true), 300)
    }
    if (document.readyState === "complete") start()
    else window.addEventListener("load", start, { once: true })
    return () => {
      window.removeEventListener("load", start)
      if (idle !== undefined) window.cancelIdleCallback(idle)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [live])
  return [live, () => setLive(true)] as const
}

function CodePreview({
  code,
  fontSize,
  dark,
  onWake,
}: {
  code: string
  fontSize: number
  dark: boolean
  onWake?: () => void
}) {
  const lines = code.split("\n")
  return (
    <div
      data-editor-preview
      aria-label="Your code (the editor is loading)"
      tabIndex={onWake ? 0 : -1}
      onPointerDown={onWake}
      onFocus={onWake}
      className="absolute inset-0 cursor-text overflow-hidden font-mono"
      style={{
        fontSize,
        lineHeight: `${Math.round(fontSize * 1.6)}px`,
        paddingTop: 12,
        background: dark ? "#1e1d18" : "#fafaf7",
        color: dark ? "#edece4" : "#26251e",
      }}
    >
      {lines.map((line, index) => (
        <div key={index} className="flex whitespace-pre">
          <span
            aria-hidden
            className="w-14 flex-none pr-6 text-right"
            style={{ color: dark ? "#6f6c62" : "#a09c92" }}
          >
            {index + 1}
          </span>
          <span>{line || " "}</span>
        </div>
      ))}
    </div>
  )
}

export interface CodeEditorHandle {
  format: () => void
}

export function CodeEditor({
  modelPrefix,
  file,
  files,
  language,
  onChange,
  onRun,
  handle,
  blockPaste = false,
  onPasteBlocked,
}: {
  /** Keeps each problem's and language's files as separate models. */
  modelPrefix: string
  file: SourceFile
  files: SourceFile[]
  language: string
  onChange: (content: string) => void
  onRun: () => void
  handle: React.RefObject<CodeEditorHandle | null>
  /** Undo pastes, for contests whose organization turned pasting off. */
  blockPaste?: boolean
  onPasteBlocked?: () => void
}) {
  const { resolvedTheme } = useTheme()
  const prefs = useLocalStore(editorPrefsStore, (value) => value)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const latest = useRef({ onRun, files, blockPaste, onPasteBlocked })
  const [live, wake] = useStartWhenIdle()
  const focusOnMount = useRef(false)
  useEffect(() => {
    if (!live) handle.current = { format: wake }
  }, [live, wake, handle])
  useEffect(() => {
    latest.current = { onRun, files, blockPaste, onPasteBlocked }
  })
  useEffect(() => {
    setWorkspaceFiles(() => latest.current.files)
  }, [])

  // Squiggles shortly after typing stops.
  const content = file.content
  useEffect(() => {
    const monaco = monacoRef.current
    const model = editorRef.current?.getModel()
    if (language !== "python" || !monaco || !model) return
    const timer = setTimeout(() => void lintPython(monaco, model), 400)
    return () => clearTimeout(timer)
  }, [content, language, file.path])

  const onMount: OnMount = (editor, monaco) => {
    monacoLoaded = true
    monacoRef.current = monaco
    editorRef.current = editor
    if (focusOnMount.current) editor.focus()
    registerLanguageServices(monaco)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      latest.current.onRun()
    )
    editor.onDidPaste(() => {
      if (!latest.current.blockPaste) return
      editor.trigger("paste-blocked", "undo", null)
      latest.current.onPasteBlocked?.()
    })
    handle.current = {
      format: () =>
        void editor.getAction("editor.action.formatDocument")?.run(),
    }
  }

  const dark = resolvedTheme === "dark"
  if (!live)
    return (
      <div className="relative h-full w-full">
        <CodePreview
          code={file.content}
          fontSize={prefs.fontSize}
          dark={dark}
          onWake={() => {
            focusOnMount.current = true
            wake()
          }}
        />
      </div>
    )

  return (
    <Editor
      path={`${modelPrefix}/${file.path}`}
      value={file.content}
      language={language}
      theme={dark ? DARK : LIGHT}
      beforeMount={defineThemes}
      onMount={onMount}
      onChange={(value) => onChange(value ?? "")}
      saveViewState
      keepCurrentModel
      loading={
        <CodePreview code={file.content} fontSize={prefs.fontSize} dark={dark} />
      }
      options={{
        fontFamily:
          "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
        fontSize: prefs.fontSize,
        lineHeight: Math.round(prefs.fontSize * 1.6),
        wordWrap: prefs.wordWrap ? "on" : "off",
        lineNumbers: "on",
        minimap: { enabled: prefs.minimap },
        scrollBeyondLastLine: false,
        tabSize: 4,
        insertSpaces: true,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: "line",
        bracketPairColorization: { enabled: true },
        wordBasedSuggestions: "currentDocument",
        ariaLabel: "Your code",
      }}
    />
  )
}
