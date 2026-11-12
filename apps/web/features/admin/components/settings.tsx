"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
  type Settings,
} from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"

import { SelectInput, TextInput } from "@/components/form"
import { api } from "@/lib/api/client"

import { Card, Loading, PageTitle } from "./shell"

const GROUPS = [...new Set(SETTING_KEYS.map((key) => SETTINGS[key].group))]

/** Generated from the registry: a new setting appears here with no UI code. */
export function AdminSettings() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<Settings>("/admin/settings"),
  })
  const save = useMutation({
    mutationFn: (changes: Partial<Settings>) =>
      api<Settings>("/admin/settings", { method: "PATCH", body: changes }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["admin", "settings"], settings)
      void queryClient.invalidateQueries({ queryKey: ["me"] })
    },
  })
  if (!data) return <Loading error={error} />

  return (
    <>
      <PageTitle>Settings</PageTitle>
      {save.error && (
        <p role="alert" className="mb-3 text-body-sm text-destructive">
          {save.error.message}
        </p>
      )}
      <div className="grid gap-4">
        {GROUPS.map((group) => (
          <Card key={group}>
            <h2 className="mb-3 text-title-sm text-ink">{group}</h2>
            <div className="grid gap-4">
              {SETTING_KEYS.filter((key) => SETTINGS[key].group === group).map(
                (key) => (
                  <SettingRow
                    key={`${key}:${JSON.stringify(data[key])}`}
                    settingKey={key}
                    value={data[key]}
                    onSave={(value) =>
                      save.mutate({ [key]: value } as Partial<Settings>)
                    }
                  />
                )
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}

function SettingRow({
  settingKey,
  value,
  onSave,
}: {
  settingKey: SettingKey
  value: Settings[SettingKey]
  onSave: (value: Settings[SettingKey]) => void
}) {
  const { label, description } = SETTINGS[settingKey]
  const [draft, setDraft] = useState(() =>
    Array.isArray(value) ? value.join(", ") : String(value)
  )

  const text = (
    <div className="min-w-0 flex-1">
      <div className="font-semibold text-ink">{label}</div>
      <div className="text-caption">{description}</div>
    </div>
  )

  const choices = (SETTINGS[settingKey] as { choices?: Record<string, string> }).choices
  if (choices) {
    return (
      <div className="flex flex-wrap items-start gap-3">
        {text}
        <SelectInput
          aria-label={label}
          className="w-full min-[901px]:w-80"
          value={String(value)}
          onChange={(event) => onSave(event.target.value as Settings[SettingKey])}
        >
          {Object.entries(choices).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </SelectInput>
      </div>
    )
  }

  if (typeof value === "boolean") {
    return (
      <label className="flex cursor-pointer items-start gap-3">
        {text}
        <Switch
          aria-label={label}
          className="mt-1"
          checked={value}
          onCheckedChange={(checked) => onSave(checked)}
        />
      </label>
    )
  }

  function commit() {
    if (typeof value === "number") onSave(Number(draft))
    else if (Array.isArray(value)) {
      onSave(
        draft
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      )
    } else onSave(draft)
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      {text}
      <div className="flex w-full items-center gap-2 min-[901px]:w-80">
        <TextInput
          aria-label={label}
          type={typeof value === "number" ? "number" : "text"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && commit()}
        />
        <Button variant="outline" size="sm" onClick={commit}>
          Save
        </Button>
      </div>
    </div>
  )
}
