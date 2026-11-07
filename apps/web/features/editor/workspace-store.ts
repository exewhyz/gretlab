import {
  isLanguageId,
  isSafePath,
  LANGUAGES,
  type SourceFile,
} from "@workspace/judge"

import { STORAGE_KEYS } from "@/features/lab/config"
import { createLocalStore } from "@/features/lab/lib/local-store"
import { progressStore } from "@/features/lab/lib/stores"
import type { EffectiveLanguage } from "@/features/settings/server"

export interface LanguageWorkspace {
  files: SourceFile[]
  entry: string
  active: string
  /** When the code last changed (ms), to tell this copy from the one saved to the account. */
  savedAt?: number
}

interface ProblemWorkspace {
  language: string
  byLanguage: Record<string, LanguageWorkspace>
}

type Workspaces = Record<string, ProblemWorkspace>

export const workspaceStore = createLocalStore<Workspaces>(
  STORAGE_KEYS.workspace,
  {},
  (raw) => raw as Workspaces
)

/**
 * The language's default file, exactly as it was handed out: saved from before the
 * problem had starter code of its own, it isn't the student's work, so that starter
 * replaces it. An editor the student emptied on purpose is their choice and stays empty.
 */
function untouched(languageId: string, content: string | undefined) {
  if (content === undefined) return true
  const blank = isLanguageId(languageId) ? LANGUAGES[languageId].starter : ""
  return blank.trim() !== "" && content.trim() === blank.trim()
}

function starterWorkspace(
  problemId: string,
  language: EffectiveLanguage
): LanguageWorkspace {
  // Code saved by the earlier single-file editor carries over as main.py.
  const old =
    language.id === "python" ? progressStore.get().code[problemId] : undefined
  // An empty or untouched file from the old editor isn't worth keeping either.
  const saved =
    old === undefined || !old.trim() || untouched(language.id, old)
      ? undefined
      : old
  return {
    files: [
      { path: language.defaultEntry, content: saved ?? language.starter },
    ],
    entry: language.defaultEntry,
    active: language.defaultEntry,
  }
}

export function currentLanguageId(
  workspaces: Workspaces,
  problemId: string,
  languages: EffectiveLanguage[]
): string | undefined {
  // This problem's language, else the one used last, else the first offered.
  const choices = [workspaces[problemId]?.language, lastLanguage()]
  return (
    choices.find((id) => languages.some((language) => language.id === id)) ??
    languages[0]?.id
  )
}

const LAST_LANGUAGE = "gretlab:last-language"

/** The language last chosen, so a new problem opens in it. */
function lastLanguage() {
  try {
    return window.localStorage.getItem(LAST_LANGUAGE) ?? undefined
  } catch {
    return undefined
  }
}

export function readWorkspace(
  workspaces: Workspaces,
  problemId: string,
  language: EffectiveLanguage
): LanguageWorkspace {
  const stored = workspaces[problemId]?.byLanguage[language.id]
  // A single blank file the student never typed in gives way to the problem's starter.
  const blank =
    stored &&
    stored.files.length === 1 &&
    stored.files[0]!.path === language.defaultEntry &&
    untouched(language.id, stored.files[0]!.content) &&
    !untouched(language.id, language.starter)
  return stored && !blank ? stored : starterWorkspace(problemId, language)
}

function change(
  problemId: string,
  language: EffectiveLanguage,
  update: (workspace: LanguageWorkspace) => LanguageWorkspace
) {
  workspaceStore.update((workspaces) => {
    const problem = workspaces[problemId]
    return {
      ...workspaces,
      [problemId]: {
        language: language.id,
        byLanguage: {
          ...problem?.byLanguage,
          [language.id]: {
            ...update(readWorkspace(workspaces, problemId, language)),
            savedAt: Date.now(),
          },
        },
      },
    }
  })
}

export function selectLanguage(problemId: string, language: EffectiveLanguage) {
  change(problemId, language, (workspace) => workspace)
  workspaceStore.persist()
  try {
    window.localStorage.setItem(LAST_LANGUAGE, language.id)
  } catch {
    // Private windows may refuse; the problem still remembers its own language.
  }
}

export function editFile(
  problemId: string,
  language: EffectiveLanguage,
  content: string
) {
  change(problemId, language, (workspace) => ({
    ...workspace,
    files: workspace.files.map((file) =>
      file.path === workspace.active ? { ...file, content } : file
    ),
  }))
}

export function openFile(
  problemId: string,
  language: EffectiveLanguage,
  path: string
) {
  change(problemId, language, (workspace) => ({ ...workspace, active: path }))
  workspaceStore.persist()
}

/** Returns a message if the name can't be used. */
export function validateName(
  workspace: LanguageWorkspace,
  name: string,
  renaming?: string
): string | null {
  if (!isSafePath(name)) {
    return "Use letters, numbers, _ - . and / for folders."
  }
  if (workspace.files.some((file) => file.path === name && name !== renaming)) {
    return "A file with that name already exists."
  }
  return null
}

export function addFile(
  problemId: string,
  language: EffectiveLanguage,
  path: string
) {
  change(problemId, language, (workspace) => ({
    ...workspace,
    files: [...workspace.files, { path, content: "" }],
    active: path,
  }))
  workspaceStore.persist()
}

export function renameFile(
  problemId: string,
  language: EffectiveLanguage,
  from: string,
  to: string
) {
  change(problemId, language, (workspace) => ({
    files: workspace.files.map((file) =>
      file.path === from ? { ...file, path: to } : file
    ),
    entry: workspace.entry === from ? to : workspace.entry,
    active: workspace.active === from ? to : workspace.active,
  }))
  workspaceStore.persist()
}

export function deleteFile(
  problemId: string,
  language: EffectiveLanguage,
  path: string
) {
  change(problemId, language, (workspace) => {
    const files = workspace.files.filter((file) => file.path !== path)
    const fallback = files[0]?.path ?? workspace.entry
    return {
      files,
      entry: workspace.entry === path ? fallback : workspace.entry,
      active: workspace.active === path ? fallback : workspace.active,
    }
  })
  workspaceStore.persist()
}

export function setEntry(
  problemId: string,
  language: EffectiveLanguage,
  path: string
) {
  change(problemId, language, (workspace) => ({ ...workspace, entry: path }))
  workspaceStore.persist()
}

export function resetWorkspace(problemId: string, language: EffectiveLanguage) {
  change(problemId, language, () => ({
    files: [{ path: language.defaultEntry, content: language.starter }],
    entry: language.defaultEntry,
    active: language.defaultEntry,
  }))
  workspaceStore.persist()
}

export function restoreWorkspace(
  problemId: string,
  language: EffectiveLanguage,
  files: SourceFile[],
  entry: string
) {
  change(problemId, language, () => ({ files, entry, active: entry }))
  workspaceStore.persist()
}

/**
 * The account's copy of the code, when it's newer than this browser's: written on another
 * computer. Doesn't change which language is open.
 */
export function adoptSavedDraft(
  problemId: string,
  language: EffectiveLanguage,
  draft: { files: SourceFile[]; entry: string; updatedAt: string }
) {
  const savedAt = new Date(draft.updatedAt).getTime()
  const local = workspaceStore.get()[problemId]?.byLanguage[language.id]
  if (local && (local.savedAt ?? 0) >= savedAt) return false
  workspaceStore.update((workspaces) => {
    const problem = workspaces[problemId]
    return {
      ...workspaces,
      [problemId]: {
        language: problem?.language ?? language.id,
        byLanguage: {
          ...problem?.byLanguage,
          [language.id]: {
            files: draft.files,
            entry: draft.entry,
            active: draft.entry,
            savedAt,
          },
        },
      },
    }
  })
  workspaceStore.persist()
  return true
}
