"use client"

import type { ReactNode } from "react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"

/**
 * What's behind a row (a student's work on a problem, a group's people), opened beside the
 * list it came from instead of below it, so it appears where the person clicked and the
 * list stays as it was. The content scrolls; the title and the close button stay put.
 * Full width on phones, `width` from sm up. Editing with a save bar is `EditorSheet`.
 */
export function DetailSheet({
  title,
  description,
  actions,
  children,
  onClose,
  width = "48rem",
  testId,
}: {
  title: ReactNode
  description?: ReactNode
  /** Buttons beside the title, such as a link to the full page. */
  actions?: ReactNode
  children: ReactNode
  onClose: () => void
  /** Max width from sm up (a CSS length). */
  width?: string
  testId?: string
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="gap-0 [--sheet-width:100%]"
        style={{ "--sheet-max-width": width } as React.CSSProperties}
        data-testid={testId}
      >
        <SheetHeader className="border-b border-hairline pe-12">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SheetTitle>{title}</SheetTitle>
            {actions}
          </div>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
