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

export interface ImportedProblem {
  id: string
  title: string
  slug: string
}

/**
 * Importing problems from a problem file (docs/problem-format.md). From the library it
 * asks where they go; from an assignment, exam or contest they're ready and kept out of
 * the library.
 */
export function ImportProblemsDialog({
  open,
  onOpenChange,
  forAssessment = false,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  forAssessment?: boolean
  onImported?: (problems: ImportedProblem[]) => void
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [listed, setListed] = useState(true)
  const [published, setPublished] = useState(false)
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(
    null
  )
  const [busy, setBusy] = useState(false)

  async function upload() {
    if (!file) return setMessage({ text: "Choose a .json file first.", kind: "err" })
    setBusy(true)
    setMessage(null)
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new Error("That file isn't valid JSON. Start from the template.")
      }
      const { created } = await api<{ created: ImportedProblem[] }>(
        owner.api("/problems/import"),
        {
          body: {
            file: parsed,
            listed: forAssessment ? false : listed,
            published: forAssessment ? true : published,
          },
        }
      )
      await client.invalidateQueries({ queryKey: ["admin"] })
      setMessage({
        text: `Imported ${created.length} ${created.length === 1 ? "problem" : "problems"}.`,
        kind: "ok",
      })
      onImported?.(created)
      if (forAssessment) onOpenChange(false)
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Import failed.", kind: "err" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import problems</DialogTitle>
          <DialogDescription>
            A JSON problem file: statement, formats, samples, hidden tests, code per
            language, hints and editorial.{" "}
            <a href="/problem-template.json" download className="underline">
              Download the template
            </a>
            .
            {forAssessment &&
              " They're added here, ready for students, and kept out of the problem library."}
          </DialogDescription>
        </DialogHeader>
        <Input
          type="file"
          accept="application/json,.json"
          aria-label="Problem file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setMessage(null)
          }}
        />
        {!forAssessment && (
          <div className="grid gap-2">
            <label className="inline-flex items-center gap-2 text-body-sm text-ink">
              <Checkbox checked={published} onCheckedChange={setPublished} />
              Publish them now
            </label>
            <label className="inline-flex items-center gap-2 text-body-sm text-ink">
              <Checkbox checked={listed} onCheckedChange={setListed} />
              Show them in the problem library
            </label>
          </div>
        )}
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
