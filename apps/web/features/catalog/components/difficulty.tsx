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
  active,
}: {
  name: string
  onClick?: () => void
  active?: boolean
}) {
  const classes = cn(
    "inline-flex items-center rounded-full border border-hairline bg-canvas-soft px-2 py-0.5 text-xs text-body",
    onClick && "cursor-pointer hover:border-hairline-strong hover:text-ink",
    active && "border-ink bg-ink text-canvas hover:text-canvas"
  )
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
    <span className={classes}>{name}</span>
  )
}
