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

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
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
    throw new ApiRequestError(
      response.status,
      data?.error?.code ?? "unknown",
      data?.error?.message ?? "Something went wrong. Please try again."
    )
  }
  return data as T
}
