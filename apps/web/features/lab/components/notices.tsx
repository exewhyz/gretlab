import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

export interface Notice {
  id: string
  text: string
}

export function Notices({ notes: general }: { notes: Notice[] }) {
  if (!general.length) return null

  return (
    <Collapsible
      defaultOpen
      className="flex-none border-b border-hairline bg-canvas-soft px-4"
    >
      <CollapsibleTrigger className="cursor-pointer py-2 text-caption font-semibold text-ink">
        Notices from your teacher ({general.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="grid max-h-[30vh] gap-2 overflow-auto pb-2.5">
        {general.map((note) => (
          <div
            key={note.id}
            className="rounded-sm border border-hairline bg-card px-3 py-2 text-body-sm wrap-anywhere whitespace-pre-wrap"
          >
            {note.text}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
