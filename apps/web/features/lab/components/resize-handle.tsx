"use client"

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"

import { cn } from "@workspace/ui/lib/utils"

import styles from "./workbench.module.scss"

const KEYS = {
  vertical: { decrease: "ArrowLeft", increase: "ArrowRight" },
  horizontal: { decrease: "ArrowUp", increase: "ArrowDown" },
}

/** A drag handle, also usable with arrow keys. Double-click resets. */
export function ResizeHandle({
  orientation,
  label,
  onDrag,
  onDragEnd,
  onStep,
  onReset,
}: {
  orientation: "vertical" | "horizontal"
  label: string
  onDrag: (event: PointerEvent) => void
  onDragEnd: () => void
  onStep: (direction: -1 | 1) => void
  onReset: () => void
}) {
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    document.body.dataset.resizing = orientation

    function stop() {
      handle.removeEventListener("pointermove", onDrag)
      handle.removeEventListener("pointerup", stop)
      handle.removeEventListener("pointercancel", stop)
      delete document.body.dataset.resizing
      onDragEnd()
    }
    handle.addEventListener("pointermove", onDrag)
    handle.addEventListener("pointerup", stop)
    handle.addEventListener("pointercancel", stop)
  }

  function onKeyDown(event: KeyboardEvent) {
    const keys = KEYS[orientation]
    if (event.key === keys.decrease || event.key === keys.increase) {
      event.preventDefault()
      onStep(event.key === keys.decrease ? -1 : 1)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={cn(styles.handle, styles[orientation])}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  )
}
