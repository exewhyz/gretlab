import { z } from "zod"

/**
 * Relative paths of plain name segments. This is a security boundary: it rules out
 * absolute paths, `..`, leading dots and every shell metacharacter, so a name can
 * neither escape the workspace nor break out of a command template.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/
export const MAX_PATH_DEPTH = 5

export function isSafePath(path: string): boolean {
  const segments = path.split("/")
  return (
    segments.length <= MAX_PATH_DEPTH &&
    segments.every((segment) => SAFE_SEGMENT.test(segment))
  )
}

export const LIMITS = {
  maxFiles: 32,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxStdinBytes: 1024 * 1024,
  maxOutputBytes: 64 * 1024,
} as const

export const sourceFileSchema = z.object({
  path: z.string().refine(isSafePath, "Invalid file name"),
  content: z.string().max(LIMITS.maxFileBytes),
})

export type SourceFile = z.infer<typeof sourceFileSchema>

const encoder = new TextEncoder()

export const sourceFilesSchema = z
  .array(sourceFileSchema)
  .min(1)
  .max(LIMITS.maxFiles)
  .superRefine((files, ctx) => {
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate file names" })
    }
    // A file can't also be a folder: "a" and "a/b".
    const paths = new Set(files.map((file) => file.path))
    for (const { path } of files) {
      const parts = path.split("/")
      for (let i = 1; i < parts.length; i++) {
        if (paths.has(parts.slice(0, i).join("/"))) {
          ctx.addIssue({ code: "custom", message: `${path} is inside a file` })
        }
      }
    }
    const total = files.reduce(
      (sum, file) => sum + encoder.encode(file.content).length,
      0
    )
    if (total > LIMITS.maxTotalBytes) {
      ctx.addIssue({ code: "custom", message: "Files are too large in total" })
    }
  })

/** A problem's code for one language. Every part is optional. */
export interface ProblemCode {
  /**
   * What a student's editor starts with, as ordinary code they can change: input reading,
   * or an empty function and the lines that call it. The language's default when empty.
   */
  starter?: string
  /** The reference solution, shown under the editorial's rules. */
  solution?: string
  /** Older problems kept code to follow the starter here; it's folded into `starter`. */
  driver?: string
}

/** A starter with older driver code after it, as one piece of code. */
export function joinStarter(parts: ProblemCode): string | undefined {
  const starter = parts.starter?.replace(/\s*$/, "") ?? ""
  const driver = parts.driver?.replace(/\s*$/, "") ?? ""
  if (!driver) return parts.starter
  return starter ? `${starter}\n\n\n${driver}\n` : `${driver}\n`
}
