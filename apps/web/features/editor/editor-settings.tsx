"use client"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"

import { ConfirmButton } from "@/components/confirm"
import { useLocalStore } from "@/features/lab/lib/local-store"
import { editorPrefsStore, saveEditorPrefs } from "@/features/lab/lib/stores"

export function EditorSettings({ onReset }: { onReset: () => void }) {
  const prefs = useLocalStore(editorPrefsStore, (value) => value)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            title="Editor settings"
            aria-label="Editor settings"
          />
        }
      >
        ⚙
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="grid w-60 gap-2 text-caption text-ink"
      >
        <label className="flex items-center justify-between gap-2">
          Font size
          <NativeSelect
            size="sm"
            aria-label="Font size"
            value={prefs.fontSize}
            onChange={(event) =>
              saveEditorPrefs({ fontSize: Number(event.target.value) })
            }
          >
            {[12, 13, 14, 15, 16, 18, 20].map((size) => (
              <NativeSelectOption key={size} value={size}>
                {size}px
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center justify-between gap-2">
          Wrap long lines
          <Checkbox
            checked={prefs.wordWrap}
            onCheckedChange={(checked) =>
              saveEditorPrefs({ wordWrap: checked })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Minimap
          <Checkbox
            checked={prefs.minimap}
            onCheckedChange={(checked) => saveEditorPrefs({ minimap: checked })}
          />
        </label>
        <ConfirmButton
          variant="ghost"
          size="xs"
          className="justify-start border-t border-hairline pt-2 text-destructive"
          title="Reset to the starter code?"
          description="Your files for this problem and language go back to the starter code. Your submissions keep their copies. This can't be undone."
          confirmLabel="Reset code"
          onConfirm={onReset}
        >
          Reset to the starter code
        </ConfirmButton>
      </PopoverContent>
    </Popover>
  )
}
