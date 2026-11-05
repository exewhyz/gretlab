import { STORAGE_KEYS } from "../config"
import type { QuestionStatus } from "../types"
import { createLocalStore } from "./local-store"

export interface Progress {
  code: Record<string, string>
  status: Record<string, QuestionStatus>
}

export const progressStore = createLocalStore<Progress>(
  STORAGE_KEYS.progress,
  { code: {}, status: {} },
  (raw) => {
    const saved = raw as Partial<Progress>
    return { code: saved.code ?? {}, status: saved.status ?? {} }
  }
)

export function saveQuestionStatus(id: string, status: QuestionStatus) {
  progressStore.update((progress) => ({
    ...progress,
    status: { ...progress.status, [id]: status },
  }))
  progressStore.persist()
}

export interface LayoutPrefs {
  listOpen: boolean
  problemOpen: boolean
  outputOpen: boolean
  /** Problem pane's share of the width it splits with the editor. */
  ratio: number
  /** Code box height in pixels, or null for the default. */
  codeHeight: number | null
}

const DEFAULT_LAYOUT: LayoutPrefs = {
  listOpen: true,
  problemOpen: true,
  outputOpen: true,
  ratio: 0.5,
  codeHeight: null,
}

export const layoutStore = createLocalStore<LayoutPrefs>(
  STORAGE_KEYS.layout,
  DEFAULT_LAYOUT,
  (raw) => {
    // The static site stored these under shorter names; carry them over.
    const saved = raw as Partial<LayoutPrefs> & {
      list?: boolean
      prob?: boolean
      out?: boolean
      codeH?: number | null
    }
    return {
      listOpen: saved.listOpen ?? saved.list ?? DEFAULT_LAYOUT.listOpen,
      problemOpen:
        saved.problemOpen ?? saved.prob ?? DEFAULT_LAYOUT.problemOpen,
      outputOpen: saved.outputOpen ?? saved.out ?? DEFAULT_LAYOUT.outputOpen,
      ratio: saved.ratio ?? DEFAULT_LAYOUT.ratio,
      codeHeight: saved.codeHeight ?? saved.codeH ?? DEFAULT_LAYOUT.codeHeight,
    }
  }
)

export function saveLayout(change: Partial<LayoutPrefs>) {
  layoutStore.update((layout) => ({ ...layout, ...change }))
  layoutStore.persist()
}

export interface EditorPrefs {
  fontSize: number
  wordWrap: boolean
  minimap: boolean
}

const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  fontSize: 13.5,
  wordWrap: false,
  minimap: false,
}

export const editorPrefsStore = createLocalStore<EditorPrefs>(
  STORAGE_KEYS.editorPrefs,
  DEFAULT_EDITOR_PREFS,
  (raw) => ({ ...DEFAULT_EDITOR_PREFS, ...(raw as Partial<EditorPrefs>) })
)

export function saveEditorPrefs(change: Partial<EditorPrefs>) {
  editorPrefsStore.update((prefs) => ({ ...prefs, ...change }))
  editorPrefsStore.persist()
}
