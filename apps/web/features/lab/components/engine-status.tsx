"use client"

import { cn } from "@workspace/ui/lib/utils"

import { useViewer } from "@/features/account/use-viewer"

import { usePythonEngine } from "../hooks/use-python-engine"

export function EngineStatusIndicator({ className }: { className?: string }) {
  const { data: viewer } = useViewer()
  const onServer = Boolean(viewer?.user && viewer.features.serverExecution)
  const inBrowser = Boolean(
    viewer && !onServer && viewer.features.browserExecution
  )
  const { status } = usePythonEngine(inBrowser)
  const ready = onServer || (inBrowser && status.state === "ready")
  const label = onServer
    ? "Server sandbox"
    : status.state === "ready"
      ? "Python ready"
      : status.state === "loading"
        ? "Loading Python…"
        : status.message

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 text-caption text-body",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 flex-none rounded-full",
          status.state === "loading" && !ready && "bg-muted-soft",
          ready && "bg-success",
          status.state === "failed" && !ready && "bg-destructive"
        )}
      />
      <span>{label}</span>
    </div>
  )
}
