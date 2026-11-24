import { reportError } from "@/lib/report-error"

/**
 * Once per server process. A promise that fails with nobody waiting for it would otherwise end
 * the process (Node's default), and with it every request the process is serving: on 24
 * November 2026 a query cancelled by the database's time limit did that. It's logged instead,
 * with the statement that failed, so it can be found and fixed.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const marked = globalThis as unknown as { gretlabRejections?: boolean }
  if (marked.gretlabRejections) return
  marked.gretlabRejections = true
  process.on("unhandledRejection", (reason) => {
    reportError(reason, { where: "unhandled rejection" })
  })
}

/** Next calls this for errors in pages, layouts and server actions: one structured log line each. */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string }
) {
  reportError(error, {
    where: context.routeType,
    route: context.routePath,
    method: request.method,
    path: request.path,
  })
}
