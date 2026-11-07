"use client"

import {
  CodeBlockIcon,
  CodeIcon,
  ImageIcon,
  LinkIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  QuotesIcon,
  TableIcon,
  TextBIcon,
  TextHThreeIcon,
  TextItalicIcon,
} from "@phosphor-icons/react"
import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"

import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { Markdown } from "./markdown"

type View = "write" | "preview" | "split"

interface Edit {
  /** Text before and after the selection, or a whole new block. */
  before: string
  after?: string
  /** Used when nothing is selected. */
  placeholder?: string
  /** Applied to each selected line instead of around the selection. */
  linePrefix?: (index: number) => string
  /** Put on its own lines, with blank lines around it. */
  block?: boolean
}

const TABLE = "| Column | Column |\n| --- | --- |\n| Cell | Cell |"

/** Sends an image to the server; answers with its URL or throws a readable message. */
async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch("/api/v1/uploads", {
    method: "POST",
    body: form,
  })
  const data = (await response.json().catch(() => null)) as {
    url?: string
    error?: { message: string }
  } | null
  if (!response.ok || !data?.url) {
    throw new Error(data?.error?.message ?? "The image didn't upload.")
  }
  return data.url
}

/** "![diagram](…)": the file's name, without its extension, as the image's alt text. */
const altFor = (file: File) =>
  file.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") || "image"

/**
 * A markdown editor: a toolbar for the common formatting, keyboard shortcuts, and a live
 * preview, side by side on wide screens. What it shows is exactly what students see,
 * because the preview uses the same renderer as the page.
 */
export function MarkdownEditor({
  value,
  onChange,
  label,
  rows = 14,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  /** The text box's accessible name. */
  label: string
  rows?: number
  placeholder?: string
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<View>("split")
  const [uploadError, setUploadError] = useState<string | null>(null)
  // The latest text, for uploads that finish after more typing.
  const latest = useRef(value)
  latest.current = value

  /**
   * Images go in at the cursor as a placeholder while they upload, then become
   * markdown pointing at the stored file.
   */
  async function insertImages(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (images.length === 0) return
    setUploadError(null)
    const el = area.current
    const at = el?.selectionStart ?? latest.current.length
    const marks = images.map(
      (f, i) => `![Uploading ${altFor(f)}…](#upload-${Date.now()}-${i})`
    )
    const lead =
      at > 0 && !latest.current.slice(0, at).endsWith("\n") ? "\n\n" : ""
    onChange(
      latest.current.slice(0, at) +
        lead +
        marks.join("\n\n") +
        "\n" +
        latest.current.slice(at)
    )
    await Promise.all(
      images.map(async (file, i) => {
        let replacement = ""
        try {
          replacement = `![${altFor(file)}](${await uploadImage(file)})`
        } catch (error) {
          setUploadError(error instanceof Error ? error.message : String(error))
        }
        // Applied to whatever the text is by then, so typing meanwhile isn't lost.
        latest.current = latest.current.replace(marks[i]!, replacement)
        onChange(latest.current)
      })
    )
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files]
    if (files.some((f) => f.type.startsWith("image/"))) {
      event.preventDefault()
      void insertImages(files)
    }
  }

  function onDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = [...event.dataTransfer.files]
    if (files.some((f) => f.type.startsWith("image/"))) {
      event.preventDefault()
      void insertImages(files)
    }
  }

  function apply(edit: Edit) {
    const el = area.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    const selected = value.slice(start, end)
    let insert: string
    if (edit.linePrefix) {
      const lines = (selected || edit.placeholder || "").split("\n")
      insert = lines.map((line, i) => edit.linePrefix!(i) + line).join("\n")
    } else {
      insert = `${edit.before}${selected || edit.placeholder || ""}${edit.after ?? ""}`
    }
    if (edit.block || edit.linePrefix) {
      const lead =
        start > 0 && !value.slice(0, start).endsWith("\n\n")
          ? value.slice(0, start).endsWith("\n")
            ? "\n"
            : "\n\n"
          : ""
      const trail = value.slice(end).startsWith("\n") ? "" : "\n"
      insert = lead + insert + trail
    }
    const next = value.slice(0, start) + insert + value.slice(end)
    onChange(next)
    // Select the placeholder (or the wrapped text) so typing replaces it.
    requestAnimationFrame(() => {
      el.focus()
      const inner = selected || edit.placeholder || ""
      const at = next.indexOf(inner, start)
      if (!edit.linePrefix && at >= 0)
        el.setSelectionRange(at, at + inner.length)
      else el.setSelectionRange(start + insert.length, start + insert.length)
    })
  }

  const tools: { label: string; icon: ReactNode; keys?: string; edit: Edit }[] =
    [
      {
        label: "Heading",
        icon: <TextHThreeIcon />,
        edit: { before: "", linePrefix: () => "### ", placeholder: "Heading" },
      },
      {
        label: "Bold",
        icon: <TextBIcon />,
        keys: "b",
        edit: { before: "**", after: "**", placeholder: "bold text" },
      },
      {
        label: "Italic",
        icon: <TextItalicIcon />,
        keys: "i",
        edit: { before: "_", after: "_", placeholder: "italic text" },
      },
      {
        label: "Code",
        icon: <CodeIcon />,
        edit: { before: "`", after: "`", placeholder: "code" },
      },
      {
        label: "Code block",
        icon: <CodeBlockIcon />,
        edit: {
          before: "```\n",
          after: "\n```",
          placeholder: "code",
          block: true,
        },
      },
      {
        label: "Bulleted list",
        icon: <ListBulletsIcon />,
        edit: { before: "", linePrefix: () => "- ", placeholder: "Item" },
      },
      {
        label: "Numbered list",
        icon: <ListNumbersIcon />,
        edit: {
          before: "",
          linePrefix: (i) => `${i + 1}. `,
          placeholder: "Item",
        },
      },
      {
        label: "Quote",
        icon: <QuotesIcon />,
        edit: { before: "", linePrefix: () => "> ", placeholder: "Quote" },
      },
      {
        label: "Link",
        icon: <LinkIcon />,
        keys: "k",
        edit: { before: "[", after: "](https://)", placeholder: "link text" },
      },
      {
        label: "Table",
        icon: <TableIcon />,
        edit: { before: TABLE, block: true },
      },
    ]

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey)) return
    const tool = tools.find((t) => t.keys === event.key.toLowerCase())
    if (!tool) return
    event.preventDefault()
    apply(tool.edit)
  }

  const showWrite = view !== "preview"
  const showPreview = view !== "write"

  return (
    <div
      data-testid="markdown-editor"
      className="overflow-hidden rounded-md border border-input bg-background"
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-hairline bg-canvas-soft px-1.5 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Image"
          title="Image (or paste or drop one into the text)"
          disabled={!showWrite}
          onClick={() => picker.current?.click()}
        >
          <ImageIcon />
        </Button>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          aria-label={`Upload an image to ${label}`}
          onChange={(e) => {
            void insertImages([...(e.target.files ?? [])])
            e.target.value = ""
          }}
        />
        {tools.map((tool) => (
          <Button
            key={tool.label}
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={tool.label}
            title={
              tool.keys
                ? `${tool.label} (Ctrl+${tool.keys.toUpperCase()})`
                : tool.label
            }
            disabled={!showWrite}
            onClick={() => apply(tool.edit)}
          >
            {tool.icon}
          </Button>
        ))}
        <span className="flex-1" />
        <div role="group" aria-label="View" className="flex gap-0.5">
          {(
            [
              ["write", "Write"],
              ["split", "Split"],
              ["preview", "Preview"],
            ] as const
          ).map(([v, text]) => (
            <Button
              key={v}
              type="button"
              size="xs"
              variant={view === v ? "secondary" : "ghost"}
              aria-pressed={view === v}
              className={cn(v === "split" && "max-[900px]:hidden")}
              onClick={() => setView(v)}
            >
              {text}
            </Button>
          ))}
        </div>
      </div>
      <div
        className={cn(
          "grid",
          view === "split" &&
            "divide-hairline min-[901px]:grid-cols-2 min-[901px]:divide-x"
        )}
      >
        {showWrite && (
          <Textarea
            ref={area}
            aria-label={label}
            rows={rows}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDrop={onDrop}
            className={cn(
              "min-h-48 resize-y rounded-none border-0 font-mono text-[13px] leading-5 shadow-none [font-variant-ligatures:none] focus-visible:ring-0",
              view === "split" && "max-[900px]:block"
            )}
          />
        )}
        {showPreview && (
          <div
            data-testid="markdown-preview"
            className={cn(
              "max-h-[32rem] min-h-48 overflow-auto p-3",
              view === "split" && "max-[900px]:hidden"
            )}
          >
            {value.trim() ? (
              <Markdown text={value} />
            ) : (
              <p className="text-caption text-body">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
      {uploadError && (
        <p
          role="alert"
          className="border-t border-hairline px-3 py-1.5 text-xs text-destructive"
        >
          {uploadError}
        </p>
      )}
      <p className="border-t border-hairline px-3 py-1.5 text-xs text-body">
        Markdown: **bold**, _italic_, `code`, ``` code blocks, - lists, | tables
        |, [links](https://). Images: the image button, or paste or drop one in
        (PNG, JPEG, GIF or WebP, up to 2 MB). HTML isn&apos;t allowed.
      </p>
    </div>
  )
}
