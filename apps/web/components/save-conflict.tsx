"use client"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"

/**
 * Shown when saving is refused because someone saved the same thing after this form was
 * opened (see lib/api/conflict.ts): take their version, or save over it on purpose.
 */
export function SaveConflict({
  onKeepMine,
}: {
  onKeepMine: () => void
}) {
  return (
    <div
      role="alert"
      data-testid="save-conflict"
      className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-body-sm text-ink"
    >
      <p>
        Someone saved this after you opened it, perhaps in another tab. Saving now would
        replace their changes with yours.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Load their version
        </Button>
        <ConfirmButton
          size="sm"
          variant="destructive"
          title="Replace their changes with yours?"
          description="Whatever they saved since you opened this is lost. This can't be undone."
          confirmLabel="Keep mine"
          onConfirm={onKeepMine}
        >
          Keep mine
        </ConfirmButton>
      </div>
    </div>
  )
}
