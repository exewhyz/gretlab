import { AsyncLocalStorage } from "node:async_hooks"

/*
 * What's known about the request being handled, for anything deep in the call that needs
 * it without passing it down (the audit log records where a change came from). Set by
 * route() in ./route.ts; empty outside a request (scripts, cron).
 */

export interface RequestInfo {
  /** The visitor's address, when this server can tell it (./client-ip.ts). */
  ip: string | null
  userAgent: string | null
  /** The organization API key this request came with, if any (features/integrations). */
  apiKey?: { id: string; orgId: string; name: string; permissions: string[] }
  /** Set when the request queued webhook deliveries, so they're sent once it's answered. */
  webhooksQueued?: boolean
}

const store = new AsyncLocalStorage<RequestInfo>()

export const withRequest = <T>(info: RequestInfo, run: () => T) =>
  store.run(info, run)

export const requestInfo = (): RequestInfo =>
  store.getStore() ?? { ip: null, userAgent: null }
