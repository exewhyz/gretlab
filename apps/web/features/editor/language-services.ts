import type { SourceFile } from "@workspace/judge"
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

/* ---------- keyword snippets, for languages with no in-browser language server ---------- */

const CPP_SNIPPETS: Record<string, string> = {
  for: "for (int ${1:i} = 0; $1 < ${2:n}; $1++) {\n\t$0\n}",
  while: "while (${1:condition}) {\n\t$0\n}",
  if: "if (${1:condition}) {\n\t$0\n}",
  main: "int main() {\n\t$0\n\treturn 0;\n}",
  cout: "std::cout << ${1:value} << '\\n';",
  cin: "std::cin >> ${1:value};",
  vector: "std::vector<${1:int}> ${2:name};",
  printf: 'printf("${1:%d}\\n", ${2:value});',
  scanf: 'scanf("${1:%d}", &${2:value});',
  include: "#include <${1:iostream}>",
}

const JAVA_SNIPPETS: Record<string, string> = {
  for: "for (int ${1:i} = 0; $1 < ${2:n}; $1++) {\n\t$0\n}",
  while: "while (${1:condition}) {\n\t$0\n}",
  if: "if (${1:condition}) {\n\t$0\n}",
  main: "public static void main(String[] args) {\n\t$0\n}",
  sout: "System.out.println(${1:value});",
  scanner: "java.util.Scanner ${1:in} = new java.util.Scanner(System.in);",
  class: "public class ${1:Name} {\n\t$0\n}",
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

  const snippets: [string, Record<string, string>][] = [
    ["c", CPP_SNIPPETS],
    ["cpp", CPP_SNIPPETS],
    ["java", JAVA_SNIPPETS],
  ]
  for (const [language, table] of snippets) {
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        )
        return {
          suggestions: Object.entries(table).map(([label, insertText]) => ({
            label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
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
