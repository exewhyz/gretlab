"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"

import { FormMessage } from "@/components/form"
import { useOwner } from "@/features/admin/owner"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { orgImportQuestions } from "@/features/orgs/content"

export interface ImportedQuestion {
  id: string
  title: string
  kind: string
}

/** Questions from a question file (docs/question-format.md) into the bank. */
export function ImportQuestionsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (questions: ImportedQuestion[]) => void
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [published, setPublished] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)

  async function upload() {
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new Error("That file isn't valid JSON. Start from the template.")
      }
      const { created } = await api<ApiResult<typeof orgImportQuestions>>(
        owner.api("/questions/import"),
        { body: { file: parsed, published } }
      )
      await client.invalidateQueries({ queryKey: ["admin"] })
      setMessage({
        text: `Imported ${created.length} ${created.length === 1 ? "question" : "questions"}.`,
        kind: "ok",
      })
      onImported?.(created)
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : "Import failed.",
        kind: "err",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import questions</DialogTitle>
          <DialogDescription>
            A JSON file of questions: choice, short and written answers, with
            their right answers and explanations. They go into your question
            bank.{" "}
            <a href="/question-template.json" download className="underline">
              Download the template
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        <Input
          type="file"
          accept="application/json,.json"
          aria-label="Question file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setMessage(null)
          }}
        />
        <label className="inline-flex items-center gap-2 text-body-sm text-ink">
          <Checkbox checked={published} onCheckedChange={setPublished} />
          Ready to use (otherwise drafts)
        </label>
        {message && <FormMessage message={message} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={busy || !file} onClick={upload}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
