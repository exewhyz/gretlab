"use client"

import { useState, type ComponentProps, type ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"

/*
 * Every destructive action (delete, remove, leave, suspend, reset) asks first, in the same
 * dialog: what will happen, then Cancel or a red button naming the action.
 */

interface ConfirmText {
  /** "Delete Week 3?" */
  title: string
  /** What happens, including whether it can be undone. */
  description?: ReactNode
  /** The red button: "Delete", "Remove", "Leave". */
  confirmLabel: string
}

/** The dialog alone, for actions started from a control that isn't a button. */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
}: ConfirmText & {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A button that confirms before doing something destructive. */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
  ...button
}: ConfirmText &
  Omit<ComponentProps<typeof Button>, "onClick" | "title"> & {
    onConfirm: () => void
    children: ReactNode
  }) {
  const [open, setOpen] = useState(false)
  // React passes events from the dialog's portal to its parents too: a button inside a
  // clickable chip or row mustn't also select it.
  const stop = (event: { stopPropagation: () => void }) =>
    event.stopPropagation()
  return (
    <span className="contents" onClick={stop} onKeyDown={stop}>
      <Button {...button} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={onConfirm}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
      />
    </span>
  )
}
