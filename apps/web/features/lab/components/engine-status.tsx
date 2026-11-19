"use client"

import { cn } from "@workspace/ui/lib/utils"

import { useViewer } from "@/features/account/use-viewer"

import { useLoadedEngine } from "../hooks/use-python-engine"

export function EngineStatusIndicator({ className }: { className?: string }) {
  const { data: viewer } = useViewer()
  const onServer = Boolean(viewer?.user && viewer.features.serverExecution)
  const inBrowser = Boolean(
    viewer && !onServer && viewer.features.browserExecution
  )
  // Never loads an engine itself: it shows the one the editor asked for, if any.
  const { status: loaded, name } = useLoadedEngine()
  const status = loaded ?? { state: "ready" as const }
  const ready = onServer || (inBrowser && status.state === "ready")
  const label = onServer
    ? "Server sandbox"
    : !inBrowser
      ? "Running code is off"
      : status.state === "ready"
        ? name
          ? `${name} ready`
          : "Runs in your browser"
        : status.state === "loading"
          ? `Loading ${name ?? "the engine"}…`
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
