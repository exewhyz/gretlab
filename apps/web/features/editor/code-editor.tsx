"use client"

import Editor, { loader, type OnMount } from "@monaco-editor/react"
import type { SourceFile } from "@workspace/judge"
import type * as Monaco from "monaco-editor"
import { useTheme } from "next-themes"
import { useEffect, useRef } from "react"

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
    monacoRef.current = monaco
    editorRef.current = editor
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

  return (
    <Editor
      path={`${modelPrefix}/${file.path}`}
      value={file.content}
      language={language}
      theme={resolvedTheme === "dark" ? DARK : LIGHT}
      beforeMount={defineThemes}
      onMount={onMount}
      onChange={(value) => onChange(value ?? "")}
      saveViewState
      keepCurrentModel
      loading={
        <div className="p-3 text-caption text-body">Loading editor…</div>
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
