"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"

import { TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import type { EffectiveLanguage } from "@/features/settings/server"
import { api } from "@/lib/api/client"

import { Loading, PageTitle, Table } from "./shell"

export function AdminLanguages() {
  const { data, error } = useQuery({
    queryKey: ["admin", "languages"],
    queryFn: () => api<EffectiveLanguage[]>("/admin/languages"),
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle>Languages</PageTitle>
      <Table
        headers={["Language", "Enabled", "Time limit (ms)", "Memory (MB)", ""]}
      >
        {data.map((language) => (
          <LanguageRow
            key={`${language.id}:${language.enabled}:${language.timeLimitMs}:${language.memoryLimitMb}`}
            language={language}
          />
        ))}
      </Table>
    </>
  )
}

function LanguageRow({ language }: { language: EffectiveLanguage }) {
  const queryClient = useQueryClient()
  const { data: viewer } = useViewer()
  const isAdmin = viewer?.user?.role === "admin"
  const [enabled, setEnabled] = useState(language.enabled)
  const [timeLimitMs, setTime] = useState(language.timeLimitMs)
  const [memoryLimitMb, setMemory] = useState(language.memoryLimitMb)
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/languages/${language.id}`, {
        method: "PUT",
        body: { enabled, timeLimitMs, memoryLimitMb },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "languages"] })
      void queryClient.invalidateQueries({ queryKey: ["me"] })
    },
  })
  return (
    <tr>
      <td>{language.label}</td>
      <td>
        <Checkbox
          aria-label={`${language.label} enabled`}
          checked={enabled}
          disabled={!isAdmin}
          onCheckedChange={(checked) => setEnabled(checked)}
        />
      </td>
      <td>
        <TextInput
          type="number"
          aria-label={`${language.label} time limit`}
          className="w-28"
          value={timeLimitMs}
          disabled={!isAdmin}
          onChange={(event) => setTime(Number(event.target.value))}
        />
      </td>
      <td>
        <TextInput
          type="number"
          aria-label={`${language.label} memory limit`}
          className="w-24"
          value={memoryLimitMb}
          disabled={!isAdmin}
          onChange={(event) => setMemory(Number(event.target.value))}
        />
      </td>
      <td>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => save.mutate()}>
            Save
          </Button>
        )}
        {save.error && (
          <div role="alert" className="text-caption text-destructive">
            {save.error.message}
          </div>
        )}
      </td>
    </tr>
  )
}
