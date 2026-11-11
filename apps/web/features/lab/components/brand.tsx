export function Brand({ title }: { title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-title-sm text-ink">
      <span
        aria-hidden
        className="font-mono text-code font-semibold text-primary"
      >
        &gt;&gt;&gt;
      </span>
      {/* Shortens with an ellipsis where the header has no room (phones). */}
      <span className="truncate">{title}</span>
    </div>
  )
}
