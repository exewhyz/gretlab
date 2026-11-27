import Link from "next/link"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"

const TONE = {
  easy: "text-success",
  medium: "text-ink",
  hard: "text-destructive",
} as const

export function Difficulty({
  level,
  className,
}: {
  level: string
  className?: string
}) {
  return (
    <span
      className={cn("capitalize", TONE[level as keyof typeof TONE], className)}
    >
      {level}
    </span>
  )
}

export function TagChip({
  name,
  onClick,
  href,
  active,
}: {
  name: string
  onClick?: () => void
  /** Makes the chip a link (a topic page). */
  href?: string
  active?: boolean
}) {
  const classes = cn(
    "inline-block max-w-full shrink-0 truncate rounded-full border border-hairline bg-canvas-soft px-2 py-0.5 align-middle text-xs text-body",
    (onClick || href) &&
      "cursor-pointer hover:border-hairline-strong hover:text-ink",
    active && "border-ink bg-ink text-canvas hover:text-canvas"
  )
  if (href) {
    return (
      <Link href={href} className={classes} title={name}>
        {name}
      </Link>
    )
  }
  return onClick ? (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-pressed={active}
      className={cn(classes, "h-auto hover:bg-muted")}
      onClick={onClick}
    >
      {name}
    </Button>
  ) : (
    <span className={classes} title={name}>
      {name}
    </span>
  )
}
