import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/** "For: CSE, 2026-A": the classes something is for, each opening its class page. */
export function ClassChips({
  classes,
  className,
}: {
  classes: { name: string; href: string }[]
  className?: string
}) {
  if (classes.length === 0) return null
  return (
    <div
      data-testid="class-chips"
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-caption text-body",
        className
      )}
    >
      For
      {classes.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          className={cn(
            buttonVariants({ variant: "outline", size: "xs" }),
            "font-normal"
          )}
        >
          {c.name}
        </Link>
      ))}
    </div>
  )
}
