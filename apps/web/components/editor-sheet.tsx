"use client"

import type { ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"

import { FormMessage } from "@/components/form"

/**
 * An editor that slides in from the right over the list it edits (a role, an API key):
 * the title at the top, the form scrolling in the middle, and the error, Cancel and the
 * main action always in reach at the bottom. Full width on phones, `width` from sm up.
 *
 * Long pickers inside (PermissionPicker) keep their search bar stuck to the top of the
 * scrolling body, which has 1rem of padding (`-top-4` meets it).
 */
export function EditorSheet({
  title,
  description,
  children,
  error,
  submitLabel,
  submitDisabled,
  onSubmit,
  onClose,
  width = "42rem",
  testId,
  extra,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  /** Why the last save failed, shown beside the buttons. */
  error?: string | null
  submitLabel: string
  submitDisabled?: boolean
  onSubmit: () => void
  onClose: () => void
  /** Max width from sm up (a CSS length). */
  width?: string
  testId?: string
  /** A secondary action at the start of the footer, such as Delete. */
  extra?: ReactNode
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="gap-0 [--sheet-width:100%]"
        style={{ "--sheet-max-width": width } as React.CSSProperties}
        data-testid={testId}
      >
        <SheetHeader className="border-b border-hairline pe-12">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4">
          {children}
        </div>
        <SheetFooter className="flex-row flex-wrap items-center border-t border-hairline">
          {extra}
          <span className="min-w-0 flex-1">
            {error && <FormMessage message={{ text: error, kind: "err" }} />}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={submitDisabled} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
