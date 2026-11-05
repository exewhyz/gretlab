import { isSafePath, type SourceFile } from "@workspace/judge"

import { STORAGE_KEYS } from "@/features/lab/config"
import { createLocalStore } from "@/features/lab/lib/local-store"
import { progressStore } from "@/features/lab/lib/stores"
import type { EffectiveLanguage } from "@/features/settings/server"

export interface LanguageWorkspace {
  files: SourceFile[]
  entry: string
  active: string
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

function starterWorkspace(
  problemId: string,
  language: EffectiveLanguage
): LanguageWorkspace {
  // Code saved by the earlier single-file editor carries over as main.py.
  const saved =
    language.id === "python" ? progressStore.get().code[problemId] : undefined
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
  const saved = workspaces[problemId]?.language
  return languages.some((language) => language.id === saved)
    ? saved
    : languages[0]?.id
}

export function readWorkspace(
  workspaces: Workspaces,
  problemId: string,
  language: EffectiveLanguage
): LanguageWorkspace {
  return (
    workspaces[problemId]?.byLanguage[language.id] ??
    starterWorkspace(problemId, language)
  )
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
          [language.id]: update(readWorkspace(workspaces, problemId, language)),
        },
      },
    }
  })
}

export function selectLanguage(problemId: string, language: EffectiveLanguage) {
  change(problemId, language, (workspace) => workspace)
  workspaceStore.persist()
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
