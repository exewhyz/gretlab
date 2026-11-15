import { LogoMark } from "@/components/logo"

/** The header's brand: GretLab's mark and the site's name (or the exam's, during one). */
export function Brand({ title }: { title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-title-sm font-semibold text-ink">
      <LogoMark className="size-7 shrink-0 text-ink" />
      {/* Shortens with an ellipsis where the header has no room (phones). */}
      <span className="truncate">{title}</span>
    </div>
  )
}
