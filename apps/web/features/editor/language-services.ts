import type { SourceFile } from "@workspace/judge"
import { completeAt, type CompletionKind } from "@workspace/judge/completion"
import type * as Monaco from "monaco-editor"

import { LAB_CONFIG } from "@/features/lab/config"

/* ---------- formatting: real formatters compiled to WebAssembly, run in the browser ---------- */

let ruffModule: Promise<typeof import("@astral-sh/ruff-wasm-web")> | null = null

function loadRuff() {
  ruffModule ??= import("@astral-sh/ruff-wasm-web").then(async (ruff) => {
    await ruff.default({ module_or_path: "/vendor/ruff_wasm_bg.wasm" })
    return ruff
  })
  return ruffModule
}

async function ruffWorkspace() {
  const ruff = await loadRuff()
  return new ruff.Workspace(
    ruff.Workspace.defaultSettings(),
    ruff.PositionEncoding.Utf16
  )
}

let clangReady: Promise<typeof import("@wasm-fmt/clang-format/web")> | null =
  null

function loadClang() {
  clangReady ??= import("@wasm-fmt/clang-format/web").then(async (clang) => {
    await clang.default("/vendor/clang-format.wasm")
    return clang
  })
  return clangReady
}

const CLANG_FILENAME: Record<string, "main.c" | "main.cpp" | "main.java"> = {
  c: "main.c",
  cpp: "main.cpp",
  java: "main.java",
}

const CLANG_STYLE = "{BasedOnStyle: Google, IndentWidth: 4, ColumnLimit: 100}"

async function formatSource(language: string, source: string): Promise<string> {
  if (language === "python") return (await ruffWorkspace()).format(source)
  const filename = CLANG_FILENAME[language]
  if (!filename) return source
  return (await loadClang()).format(source, filename, CLANG_STYLE)
}

/* ---------- Python completions: Jedi in a worker, aware of the student's other files ---------- */

interface JediItem {
  name: string
  type: string
  insert: string
}

let completionWorker: Worker | null = null
let nextRequest = 0
const pending = new Map<number, (items: JediItem[]) => void>()

function requestPythonCompletions(
  files: SourceFile[],
  path: string,
  line: number,
  column: number
): Promise<JediItem[]> {
  if (!completionWorker) {
    const url = new URL("/py-completion-worker.js", document.baseURI)
    url.searchParams.set(
      "u",
      new URL(LAB_CONFIG.pyodideUrl, document.baseURI).href
    )
    completionWorker = new Worker(url.href)
    completionWorker.onmessage = (event: MessageEvent) => {
      const { id, items } = event.data as { id: number; items: JediItem[] }
      pending.get(id)?.(items)
      pending.delete(id)
    }
  }
  const id = ++nextRequest
  return new Promise((resolve) => {
    pending.set(id, resolve)
    completionWorker?.postMessage({ id, files, path, line, column })
  })
}

/* ---------- registration ---------- */

type FilesGetter = () => SourceFile[]
let getFiles: FilesGetter = () => []

/** The editor tells this module which files are open, for cross-file completions. */
export function setWorkspaceFiles(getter: FilesGetter) {
  getFiles = getter
}

/** A model's URI is file:///<problem>/<language>/<path>. */
export function pathOfModel(model: Monaco.editor.ITextModel) {
  return model.uri.path.split("/").slice(3).join("/")
}

let registered = false

export function registerLanguageServices(monaco: typeof Monaco) {
  if (registered) return
  registered = true

  for (const language of ["python", "c", "cpp", "java"]) {
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model) {
        const formatted = await formatSource(language, model.getValue())
        return [{ range: model.getFullModelRange(), text: formatted }]
      },
    })
  }

  monaco.languages.registerCompletionItemProvider("python", {
    triggerCharacters: ["."],
    async provideCompletionItems(model, position) {
      const path = pathOfModel(model)
      const files = getFiles().map((file) =>
        file.path === path ? { ...file, content: model.getValue() } : file
      )
      const items = await requestPythonCompletions(
        files,
        path,
        position.lineNumber,
        position.column - 1
      )
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      )
      const kinds: Record<string, Monaco.languages.CompletionItemKind> = {
        function: monaco.languages.CompletionItemKind.Function,
        class: monaco.languages.CompletionItemKind.Class,
        module: monaco.languages.CompletionItemKind.Module,
        keyword: monaco.languages.CompletionItemKind.Keyword,
        instance: monaco.languages.CompletionItemKind.Variable,
        statement: monaco.languages.CompletionItemKind.Variable,
        param: monaco.languages.CompletionItemKind.Variable,
      }
      return {
        suggestions: items.map((item) => ({
          label: item.name,
          kind: kinds[item.type] ?? monaco.languages.CompletionItemKind.Text,
          insertText: item.insert,
          range,
        })),
      }
    },
  })

  // C, C++ and Java: read from the student's files in the browser (packages/judge/src/completion.ts).
  const kinds: Record<CompletionKind, Monaco.languages.CompletionItemKind> = {
    keyword: monaco.languages.CompletionItemKind.Keyword,
    snippet: monaco.languages.CompletionItemKind.Snippet,
    function: monaco.languages.CompletionItemKind.Function,
    method: monaco.languages.CompletionItemKind.Method,
    field: monaco.languages.CompletionItemKind.Field,
    variable: monaco.languages.CompletionItemKind.Variable,
    class: monaco.languages.CompletionItemKind.Class,
    module: monaco.languages.CompletionItemKind.Module,
    constant: monaco.languages.CompletionItemKind.Constant,
  }
  for (const language of ["c", "cpp", "java"] as const) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: language === "java" ? ["."] : [".", ">", ":", "<"],
      provideCompletionItems(model, position) {
        const path = pathOfModel(model)
        const files = getFiles().map((file) =>
          file.path === path ? { ...file, content: model.getValue() } : file
        )
        if (!files.some((file) => file.path === path))
          files.push({ path, content: model.getValue() })
        const items = completeAt({
          language,
          files,
          path,
          offset: model.getOffsetAt(position),
        })
        const word = model.getWordUntilPosition(position)
        // Header names hold "/", "+" and ".": replace everything typed since the "<".
        const line = model.getLineContent(position.lineNumber)
        const angle = line.lastIndexOf("<", position.column - 2)
        const startColumn =
          /^\s*#\s*include\s*</.test(line) && angle >= 0
            ? angle + 2
            : word.startColumn
        const range = new monaco.Range(
          position.lineNumber,
          startColumn,
          position.lineNumber,
          position.column
        )
        return {
          suggestions: items.map((item, index) => ({
            label: item.label,
            kind: kinds[item.kind],
            detail: item.detail,
            insertText: item.insert,
            insertTextRules: item.snippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            // Keep the engine's order: the student's own names first.
            sortText: String(index).padStart(4, "0"),
            range,
          })),
        }
      },
    })
  }
}

/** Ruff's findings as editor squiggles. Python only. */
export async function lintPython(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel
) {
  const workspace = await ruffWorkspace()
  if (model.isDisposed()) return
  interface Finding {
    code: string | null
    message: string
    start_location: { row: number; column: number }
    end_location: { row: number; column: number }
  }
  let findings: Finding[]
  try {
    findings = workspace.check(model.getValue()) as Finding[]
  } catch {
    return
  }
  monaco.editor.setModelMarkers(
    model,
    "ruff",
    findings.map((finding) => ({
      severity: finding.code
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Error,
      message: finding.code
        ? `${finding.code}: ${finding.message}`
        : finding.message,
      startLineNumber: finding.start_location.row,
      startColumn: finding.start_location.column,
      endLineNumber: finding.end_location.row,
      endColumn: finding.end_location.column,
    }))
  )
}
