/** A failed API call, carrying the server's message so it can be shown as-is. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

import { askForStepUp } from "./step-up"

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
  /** Already asked for a code once: a second refusal is shown, not asked again. */
  steppedUp = false
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers:
      options.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const data = (await response.json().catch(() => null)) as {
    error?: { code: string; message: string }
  } | null
  if (!response.ok) {
    // A protected action wants a fresh second-factor code: ask, then do it again.
    if (
      response.status === 403 &&
      data?.error?.code === "step_up_required" &&
      !steppedUp &&
      (await askForStepUp())
    )
      return api<T>(path, options, true)
    throw new ApiRequestError(
      response.status,
      data?.error?.code ?? "unknown",
      data?.error?.message ?? "Something went wrong. Please try again."
    )
  }
  return data as T
}
