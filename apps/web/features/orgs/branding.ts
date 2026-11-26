/**
 * An organization's branding: its logo and brand colour (packages/judge/src/branding.ts), set by
 * whoever may change its settings across the organization. The colour must stand out on both
 * the light and dark page; the logo is a PNG or JPEG (PDFs can hold those) of up to 2 MB, stored
 * like any uploaded image. Every change is in the activity log.
 */
import { getDb, organizations, sql, type User } from "@workspace/db"
import { accentProblem, type Branding } from "@workspace/judge"

import { brandOf } from "@/features/orgs/brand"
import { context, need, writeAudit } from "@/features/orgs/server"
import { storeImage } from "@/features/uploads/server"
import { ApiError } from "@/lib/api/route"

const { eq } = sql

async function manager(slug: string, user: User) {
  const ctx = await context(slug, user)
  need(ctx, "org.settings.manage")
  return ctx
}

export async function getBranding(slug: string, user: User) {
  const ctx = await manager(slug, user)
  return brandOf(ctx.org)
}

async function save(orgId: string, branding: Branding) {
  await getDb()
    .update(organizations)
    .set({ branding })
    .where(eq(organizations.id, orgId))
}

/** Sets the brand colour, or null for GretLab's own. */
export async function saveAccent(
  slug: string,
  user: User,
  accent: string | null
) {
  const ctx = await manager(slug, user)
  if (accent !== null) {
    const problem = accentProblem(accent)
    if (problem) throw new ApiError(400, "bad_colour", problem)
  }
  const before = ctx.org.branding.accent ?? null
  await save(ctx.org.id, { ...ctx.org.branding, accent })
  if (before !== accent)
    await writeAudit(
      ctx,
      "org.branding",
      accent
        ? `Set the brand colour to ${accent}`
        : "Went back to GretLab's colour",
      { changes: [{ field: "Brand colour", from: before, to: accent }] }
    )
  return brandOf({ branding: { ...ctx.org.branding, accent } })
}

/** Replaces the logo with an uploaded PNG or JPEG. */
export async function saveLogo(slug: string, user: User, file: File) {
  const ctx = await manager(slug, user)
  const { id } = await storeImage(user, file, {
    types: ["image/png", "image/jpeg"],
    message: "Use a PNG or JPEG for the logo.",
  })
  const branding = { ...ctx.org.branding, logo: id }
  await save(ctx.org.id, branding)
  await writeAudit(ctx, "org.branding", "Changed the logo", {
    changes: [
      {
        field: "Logo",
        from: ctx.org.branding.logo ? "A logo" : "None",
        to: "A new logo",
      },
    ],
  })
  return brandOf({ branding })
}

export async function removeLogo(slug: string, user: User) {
  const ctx = await manager(slug, user)
  const branding = { ...ctx.org.branding, logo: null }
  await save(ctx.org.id, branding)
  if (ctx.org.branding.logo)
    await writeAudit(ctx, "org.branding", "Removed the logo", {
      changes: [{ field: "Logo", from: "A logo", to: "None" }],
    })
  return brandOf({ branding })
}
