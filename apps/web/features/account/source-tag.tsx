import { cn } from "@workspace/ui/lib/utils"

/**
 * Where an item comes from, beside it in a list: an organization's name, or "Platform"
 * for the platform's own (no organization). Lists that follow the header's organization
 * switcher show it so a mixed list says what's from where.
 */
export function SourceTag({
  name,
  className,
}: {
  /** The organization's name; null for the platform's own. */
  name: string | null | undefined
  className?: string
}) {
  return (
    <span
      data-testid="source-tag"
      className={cn(
        "inline-flex max-w-56 items-center rounded-md border border-hairline px-1.5 py-px align-middle text-caption leading-tight text-muted-foreground",
        className
      )}
    >
      <span className="truncate" title={name ?? "Platform"}>
        {name ?? "Platform"}
      </span>
    </span>
  )
}
