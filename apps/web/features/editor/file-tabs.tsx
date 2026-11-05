"use client"

import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"

import { ConfirmButton } from "@/components/confirm"
import { useQuestionSession } from "@/features/lab/hooks/use-question-session"
import styles from "@/features/lab/components/workbench.module.scss"

import { validateName } from "./workspace-store"

type NameEdit = { mode: "add" } | { mode: "rename"; from: string }

export function FileTabs() {
  const { workspace, files } = useQuestionSession()
  const [edit, setEdit] = useState<NameEdit | null>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  if (!workspace) return null

  function begin(next: NameEdit) {
    setEdit(next)
    setName(next.mode === "rename" ? next.from : "")
    setError(null)
  }

  function commit() {
    if (!workspace || !edit) return
    const trimmed = name.trim()
    const problem = validateName(
      workspace,
      trimmed,
      edit.mode === "rename" ? edit.from : undefined
    )
    if (problem) {
      setError(problem)
      return
    }
    if (edit.mode === "add") files.add(trimmed)
    else files.rename(edit.from, trimmed)
    setEdit(null)
  }

  const active = workspace.active

  return (
    <>
      <div className={styles.fileTabs} role="tablist" aria-label="Files">
        {workspace.files.map((file) => (
          <Button
            key={file.path}
            type="button"
            variant="ghost"
            role="tab"
            aria-selected={file.path === active}
            className={cn(styles.fileTab, "h-auto")}
            title={file.path === workspace.entry ? "Runs first" : file.path}
            onClick={() => files.open(file.path)}
          >
            {file.path === workspace.entry && (
              <span aria-label="Entry file" className={styles.entryMark}>
                ▶
              </span>
            )}
            {file.path}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-1 flex-none"
          title="New file"
          aria-label="New file"
          onClick={() => begin({ mode: "add" })}
        >
          +
        </Button>
        <span className="min-w-2 flex-1" />
        {active !== workspace.entry && (
          <Button
            variant="ghost"
            size="xs"
            className="flex-none"
            onClick={() => files.setEntry(active)}
          >
            Run this file
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="flex-none"
          onClick={() => begin({ mode: "rename", from: active })}
        >
          Rename
        </Button>
        <ConfirmButton
          variant="ghost"
          size="xs"
          className="mr-1 flex-none"
          disabled={workspace.files.length === 1}
          title={`Delete ${active}?`}
          description="Its code is gone for good. Submissions already made keep their copy."
          confirmLabel="Delete file"
          onConfirm={() => files.remove(active)}
        >
          Delete
        </ConfirmButton>
      </div>
      {edit && (
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-hairline bg-canvas-soft px-3 py-2 text-caption">
          <Input
            autoFocus
            aria-label="File name"
            placeholder="helper.py or pkg/helper.py"
            value={name}
            className="h-7 min-w-48 flex-1 bg-card font-mono text-code text-ink"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit()
              if (event.key === "Escape") setEdit(null)
            }}
          />
          <Button size="xs" onClick={commit}>
            {edit.mode === "add" ? "Create" : "Rename"}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setEdit(null)}>
            Cancel
          </Button>
          {error && (
            <span role="alert" className="w-full text-destructive">
              {error}
            </span>
          )}
        </div>
      )}
    </>
  )
}
