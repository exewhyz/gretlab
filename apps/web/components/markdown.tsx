import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@workspace/ui/lib/utils"

import styles from "./markdown.module.scss"

/**
 * Markdown written by staff: problem descriptions, editorials, hints. GitHub-flavoured
 * (tables, task lists, strikethrough). Raw HTML in it is shown as text, never run, so
 * any teacher or organization can write it safely. Works on the server and the client.
 */
export function Markdown({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <div className={cn(styles.md, className)} data-testid="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Uploaded images and diagrams: sized to the column, loaded when scrolled to.
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              // eslint-disable-next-line @next/next/no-img-element -- any size, any host
              <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" />
            ) : null,
          // Links leave the problem in a new tab and pass nothing back to it.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
