/**
 * An unexpected failure, written to the server log as one line of JSON (searchable in the
 * host's log viewer) with a short reference the person who hit it can quote. Nothing about
 * the error reaches the caller beyond that reference.
 */
export function reportError(
  error: unknown,
  context: Record<string, string | null | undefined>
): string {
  const ref = globalThis.crypto.randomUUID().slice(0, 8)
  const err = error instanceof Error ? error : new Error(String(error))
  const cause = (err as { cause?: { code?: string; message?: string } }).cause
  console.error(
    JSON.stringify({
      level: "error",
      ref,
      at: new Date().toISOString(),
      ...context,
      name: err.name,
      message: err.message,
      ...(cause?.code ? { cause: `${cause.code} ${cause.message ?? ""}`.trim() } : {}),
      stack: err.stack?.split("\n").slice(1, 9).map((l) => l.trim()),
    })
  )
  return ref
}
