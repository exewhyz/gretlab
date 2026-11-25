import { reportError } from "@/lib/report-error"

/*
 * Node.js only (instrumentation.ts imports this when NEXT_RUNTIME is "nodejs"; the Edge runtime
 * has no process.on). A promise that fails with nobody waiting for it would otherwise end the
 * process (Node's default), and with it every request the process is serving: on 24 November
 * 2026 a query cancelled by the database's time limit did that. It's logged instead, with the
 * statement that failed, so it can be found and fixed.
 */
const marked = globalThis as unknown as { gretlabRejections?: boolean }
if (!marked.gretlabRejections) {
  marked.gretlabRejections = true
  process.on("unhandledRejection", (reason) => {
    reportError(reason, { where: "unhandled rejection" })
  })
}
