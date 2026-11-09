import type { User } from "@workspace/db"
import type { Permission } from "@workspace/judge"

import { canAnywhere, orgContext, writeAudit } from "@/features/orgs/server"
import { ApiError } from "@/lib/api/route"

import {
  changeCollection,
  copyToLibrary,
  deleteCollection,
  getLibrary,
  saveCollection,
} from "./server"

/** A college's library: for people who write content or set work there. */
async function libraryContext(slug: string, user: User, write = false) {
  const ctx = await orgContext(slug, user)
  const needed: Permission[] = write
    ? ["problems.manage"]
    : ["problems.manage", "assignments.manage", "contests.manage"]
  if (!needed.some((p) => canAnywhere(ctx, p))) {
    throw new ApiError(403, "forbidden", "You don't have permission to do that.")
  }
  return ctx
}

export async function orgLibrary(slug: string, user: User) {
  const ctx = await libraryContext(slug, user)
  return getLibrary(ctx.org.id, user.id)
}

export async function orgCopyToLibrary(
  slug: string,
  user: User,
  items: { kind: "problem" | "question"; id: string }[]
) {
  const ctx = await libraryContext(slug, user, true)
  const result = await copyToLibrary(ctx.org.id, items, user.id)
  await writeAudit(ctx, "library.copy", `Copied ${result.created.length} items into the library`, {
    items: result.created.map((c) => c.title),
  })
  return result
}

export async function orgSaveCollection(
  slug: string,
  user: User,
  id: string | null,
  input: { name: string; description: string }
) {
  const ctx = await libraryContext(slug, user)
  return saveCollection(ctx.org.id, id, input)
}

export async function orgDeleteCollection(slug: string, user: User, id: string) {
  const ctx = await libraryContext(slug, user)
  await deleteCollection(ctx.org.id, id)
}

export async function orgChangeCollection(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof changeCollection>[2]
) {
  const ctx = await libraryContext(slug, user)
  await changeCollection(ctx.org.id, id, input, user.id)
}
