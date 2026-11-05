import {
  getDb,
  languageConfigs,
  settings as settingsTable,
} from "@workspace/db"
import {
  LANGUAGE_IDS,
  LANGUAGES,
  resolveSettings,
  SETTINGS,
  type LanguageId,
  type SettingKey,
  type Settings,
} from "@workspace/judge"

import { ApiError } from "@/lib/api/route"
import { cached, invalidate } from "@/lib/ttl-cache"

const SETTINGS_KEY = "settings"
const LANGUAGES_KEY = "languages"
/** Every other replica sees a dashboard change within this long. */
const CONFIG_TTL_MS = 5000

export async function getSettings(): Promise<Settings> {
  return cached(SETTINGS_KEY, CONFIG_TTL_MS, async () => {
    const rows = await getDb().select().from(settingsTable)
    return resolveSettings(
      Object.fromEntries(rows.map((row) => [row.key, row.value]))
    )
  })
}

export async function requireFeature(key: SettingKey) {
  const settings = await getSettings()
  if (settings[key] !== true) {
    throw new ApiError(
      403,
      "feature_disabled",
      `${SETTINGS[key].label} is turned off.`
    )
  }
  return settings
}

export async function updateSettings(changes: Record<string, unknown>) {
  const db = getDb()
  const parsed = Object.entries(changes).map(([key, value]) => {
    const definition = SETTINGS[key as SettingKey]
    if (!definition) {
      throw new ApiError(400, "unknown_setting", `Unknown setting: ${key}`)
    }
    const result = definition.schema.safeParse(value)
    if (!result.success) {
      throw new ApiError(400, "invalid_setting", `Invalid value for ${key}`)
    }
    return { key, value: result.data as unknown }
  })
  await db.transaction(async (tx) => {
    for (const row of parsed) {
      await tx
        .insert(settingsTable)
        .values(row)
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: row.value },
        })
    }
  })
  invalidate(SETTINGS_KEY)
  return getSettings()
}

export function invalidateLanguages() {
  invalidate(LANGUAGES_KEY)
}

export interface EffectiveLanguage {
  id: LanguageId
  label: string
  editorLanguage: string
  extensions: string[]
  defaultEntry: string
  starter: string
  enabled: boolean
  timeLimitMs: number
  memoryLimitMb: number
}

/** The code-defined registry with the dashboard's overrides applied. */
export async function getLanguages(): Promise<EffectiveLanguage[]> {
  const rows = await cached(LANGUAGES_KEY, CONFIG_TTL_MS, () =>
    getDb().select().from(languageConfigs)
  )
  return LANGUAGE_IDS.map((id) => {
    const definition = LANGUAGES[id]
    const override = rows.find((row) => row.id === id)
    return {
      id,
      label: definition.label,
      editorLanguage: definition.editorLanguage,
      extensions: definition.extensions,
      defaultEntry: definition.defaultEntry,
      starter: definition.starter,
      enabled: override?.enabled ?? true,
      timeLimitMs: override?.timeLimitMs ?? definition.defaults.timeLimitMs,
      memoryLimitMb:
        override?.memoryLimitMb ?? definition.defaults.memoryLimitMb,
    }
  })
}
