import type { User } from "@workspace/db"
import { NextResponse, type NextRequest } from "next/server"
import { z, type ZodType } from "zod"

import { getCurrentUser } from "@/features/auth/current-user"

const MAX_BODY_BYTES = 8 * 1024 * 1024

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

/** Who may call a route. Each level includes the ones after it: admin > teacher > user. */
export type Access = "public" | "user" | "teacher" | "admin"

const ROLE_RANK = { student: 0, teacher: 1, admin: 2 } as const
const REQUIRED_RANK = { user: 0, teacher: 1, admin: 2 } as const

export function isStaff(user: User | null): boolean {
  return user?.role === "teacher" || user?.role === "admin"
}

function authorize(user: User | null, access: Access) {
  if (access === "public") return
  if (!user) throw new ApiError(401, "unauthenticated", "Please sign in.")
  if (ROLE_RANK[user.role] < REQUIRED_RANK[access]) {
    throw new ApiError(403, "forbidden", "You don't have access to this.")
  }
}

/** Cookies are SameSite=Lax; this also rejects cross-site writes from older browsers. */
function assertSameOrigin(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return
  const origin = request.headers.get("origin")
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    throw new ApiError(403, "bad_origin", "Cross-site request refused.")
  }
}

/** Database constraints that a person can hit by ordinary use, in plain words. */
function constraintMessage(error: unknown): string | null {
  const cause = (error as { cause?: { code?: string } }).cause
  if (cause?.code === "23505") return "That address is already in use."
  if (cause?.code === "23503") {
    return "This is still in use by something else, such as a contest."
  }
  return null
}

type RouteContext = { params: Promise<Record<string, string | string[]>> }

interface Handler<A extends Access, B> {
  user: A extends "public" ? User | null : User
  body: B
  params: Record<string, string>
  query: URLSearchParams
  /** The raw request, for bodies that aren't JSON (file uploads). */
  request: NextRequest
}

/**
 * Every API route goes through this: auth, same-origin check, body validation and one
 * error shape. Handlers stay short; business logic belongs in features/x/server.
 */
export function route<A extends Access, S extends ZodType = ZodType<undefined>>(
  options: { access: A; body?: S },
  handler: (context: Handler<A, z.infer<S>>) => Promise<unknown>
) {
  return async (request: NextRequest, context: RouteContext) => {
    try {
      assertSameOrigin(request)
      const user = await getCurrentUser()
      authorize(user, options.access)

      let body: unknown
      if (options.body) {
        // Generous for the largest valid request, and refuses the rest before parsing.
        const size = Number(request.headers.get("content-length") ?? 0)
        if (size > MAX_BODY_BYTES) {
          throw new ApiError(413, "too_large", "That request is too large.")
        }
        const raw: unknown = await request.json().catch(() => {
          throw new ApiError(400, "invalid_json", "Request body must be JSON.")
        })
        const parsed = options.body.safeParse(raw)
        if (!parsed.success) {
          return NextResponse.json(
            {
              error: {
                code: "validation_error",
                message: parsed.error.issues[0]?.message ?? "Invalid request.",
                issues: z.flattenError(parsed.error),
              },
            },
            { status: 400 }
          )
        }
        body = parsed.data
      }

      const data = await handler({
        user: user as Handler<A, z.infer<S>>["user"],
        body: body as z.infer<S>,
        params: (await context.params) as Record<string, string>,
        query: request.nextUrl.searchParams,
        request,
      })
      // A handler may answer with its own Response, for downloads such as CSV.
      if (data instanceof Response) return data
      return NextResponse.json(data ?? { ok: true })
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          {
            status: error.status,
            headers: error.retryAfter
              ? { "Retry-After": String(error.retryAfter) }
              : undefined,
          }
        )
      }
      const conflict = constraintMessage(error)
      if (conflict) {
        return NextResponse.json(
          { error: { code: "conflict", message: conflict } },
          { status: 409 }
        )
      }
      // Internals go to the server log, never to the caller.
      console.error("[api] unhandled error:", error)
      return NextResponse.json(
        { error: { code: "internal", message: "Something went wrong." } },
        { status: 500 }
      )
    }
  }
}
