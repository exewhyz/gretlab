import type { ComponentProps } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"

/** Tab buttons shared by the output panel and the teacher sidebar. */
export function TabButton({
  selected,
  className,
  ...props
}: ComponentProps<"button"> & { selected: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      role="tab"
      aria-selected={selected}
      className={cn(
        "-mb-px h-auto rounded-none border-0 border-b-2 border-transparent px-3.5 py-2 text-caption font-medium text-body hover:bg-transparent",
        selected && "border-ink bg-card text-ink",
        className
      )}
      {...props}
    />
  )
}
