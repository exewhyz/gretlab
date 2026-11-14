import type { User } from "@workspace/db"
import { after, NextResponse, type NextRequest } from "next/server"
import { z, type ZodType } from "zod"

import { isPlatformPermission, type PlatformPermission } from "@workspace/judge"

import { readSession } from "@/features/auth/current-user"
import { mustUseTwoFactor } from "@/features/auth/two-factor"
import { deliverDueWebhooks } from "@/features/integrations/deliver"
import { userForApiKey } from "@/features/integrations/keys"
import { platformCan } from "@/features/platform/access"

import { clientIp } from "./client-ip"
import { ApiError } from "./errors"
import { withRequest, type RequestInfo } from "./request-context"
import { reportError } from "../report-error"

const MAX_BODY_BYTES = 8 * 1024 * 1024

export { ApiError, notFound } from "./errors"

/**
 * Who may call a route: anyone, any signed-in person, platform staff by account role
 * (admin > teacher), or whoever holds one platform permission (features/platform/access.ts).
 */
export type Access =
  | "public"
  | "user"
  | "teacher"
  | "admin"
  | PlatformPermission
  /** Any one of these platform permissions (e.g. a library page for writers and editors). */
  | readonly PlatformPermission[]

const ROLE_RANK = { student: 0, teacher: 1, admin: 2 } as const
const REQUIRED_RANK = { user: 0, teacher: 1, admin: 2 } as const

export function isStaff(user: User | null): boolean {
  return user?.role === "teacher" || user?.role === "admin"
}

async function authorize(user: User | null, access: Access) {
  if (access === "public") return
  if (!user) throw new ApiError(401, "unauthenticated", "Please sign in.")
  if (Array.isArray(access) || isPlatformPermission(access as string)) {
    const any = (Array.isArray(access) ? access : [access]) as PlatformPermission[]
    const held = await Promise.all(any.map((p) => platformCan(user, p)))
    if (!held.some(Boolean)) {
      throw new ApiError(403, "forbidden", "You don't have access to this.")
    }
    return
  }
  if (ROLE_RANK[user.role] < REQUIRED_RANK[access as keyof typeof REQUIRED_RANK]) {
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
/** Fields never sent to a browser, wherever they turn up in a response. */
const SECRET_FIELDS = new Set(["passwordHash", "password_hash"])
const withoutSecrets = (key: string, value: unknown) => (SECRET_FIELDS.has(key) ? undefined : value)

export function route<A extends Access, S extends ZodType = ZodType<undefined>>(
  options: {
    access: A
    body?: S
    /** Reachable by someone the platform requires to use two-factor before they have (their security page). */
    beforeTwoFactor?: boolean
  },
  handler: (context: Handler<A, z.infer<S>>) => Promise<unknown>
) {
  return async (request: NextRequest, context: RouteContext) => {
    try {
      // Another system with an organization API key: it acts as the key's maker, limited to
      // the key's permissions and its organization (features/integrations/keys.ts).
      const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(glk_\S+)$/i)?.[1]
      const keyed = bearer
        ? await userForApiKey(bearer, request.nextUrl.pathname)
        : null
      if (!keyed) assertSameOrigin(request)
      const session = keyed
        ? { user: keyed.user, twoFactor: true, pending: null }
        : await readSession()
      const user = session.user
      if (keyed && !(options.access === "user" || options.access === "public"))
        throw new ApiError(403, "forbidden", "An API key can't use this.")
      await authorize(user, options.access)
      // Required two-factor not yet on: only the security page's routes until it is.
      if (
        !keyed &&
        user &&
        options.access !== "public" &&
        !options.beforeTwoFactor &&
        !session.twoFactor &&
        (await mustUseTwoFactor(user))
      ) {
        throw new ApiError(
          403,
          "two_factor_required",
          "Your account needs two-factor sign-in. Turn it on under Security first."
        )
      }

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

      const params = (await context.params) as Record<string, string>
      // Where the request came from, for the audit log (lib/api/request-context.ts).
      const info: RequestInfo = {
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
        ...(keyed ? { apiKey: keyed.key } : {}),
      }
      const data = await withRequest(info, () =>
        handler({
          user: user as Handler<A, z.infer<S>>["user"],
          body: body as z.infer<S>,
          params,
          query: request.nextUrl.searchParams,
          request,
        })
      )
      // Webhooks this request queued go out once it's answered (and the cron retries them).
      if (info.webhooksQueued) after(() => deliverDueWebhooks())
      // A handler may answer with its own Response, for downloads such as CSV.
      if (data instanceof Response) return data
      // A safety net: a password hash never leaves the server, even in a whole user row.
      return new NextResponse(JSON.stringify(data ?? { ok: true }, withoutSecrets), {
        headers: { "content-type": "application/json" },
      })
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
      // Internals go to the server log, never to the caller: they get a reference to quote.
      const ref = reportError(error, {
        where: "api",
        method: request.method,
        path: request.nextUrl.pathname,
      })
      return NextResponse.json(
        {
          error: {
            code: "internal",
            message: `Something went wrong. If it keeps happening, quote ${ref}.`,
            ref,
          },
        },
        { status: 500 }
      )
    }
  }
}
