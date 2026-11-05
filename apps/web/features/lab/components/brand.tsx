export function Brand({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5 text-title-sm text-ink">
      <span
        aria-hidden
        className="font-mono text-code font-semibold text-primary"
      >
        &gt;&gt;&gt;
      </span>
      {title}
    </div>
  )
}
