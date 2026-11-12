/*
 * The one error shape API routes answer with (lib/api/route.ts maps these to JSON). Its
 * own file so server code can throw them without importing the route wrapper, which
 * imports the session and would make a cycle.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Seconds, sent as Retry-After, when the server is shedding load. */
    readonly retryAfter?: number
  ) {
    super(message)
  }
}

export const notFound = (what = "Not found") =>
  new ApiError(404, "not_found", what)
