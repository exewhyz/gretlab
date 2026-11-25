import { reportError } from "@/lib/report-error"

/** Once per server process. Node-only code is imported only there (Next's guide). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node")
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
