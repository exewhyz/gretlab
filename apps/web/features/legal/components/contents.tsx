"use client"

import { CaretDownIcon } from "@phosphor-icons/react"
import { useState } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

/*
 * A legal document's contents: beside the text on wide screens, folded behind "On this page"
 * on phones and tablets, so the text starts on the first screen. Choosing a section folds it
 * again.
 */
export function Contents({ sections }: { sections: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false)
  const list = (onPick?: () => void) => (
    <ol className="grid gap-1.5 border-l border-hairline text-body-sm">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            onClick={onPick}
            className="-ml-px block border-l border-transparent py-0.5 pl-3 text-muted-foreground hover:border-ink hover:text-ink"
          >
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  )
  return (
    <>
      <nav aria-label="On this page" className="hidden gap-3 lg:grid">
        <p className="text-caption-upper text-muted-foreground">On this page</p>
        {list()}
      </nav>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="rounded-xl border border-hairline bg-card lg:hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-body-sm font-medium text-ink">
          On this page
          <CaretDownIcon
            aria-hidden
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <nav aria-label="On this page" className="px-4 pb-4">
            {list(() => setOpen(false))}
          </nav>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
