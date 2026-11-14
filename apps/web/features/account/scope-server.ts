/*
 * The header's organization switcher, as the server reads it (`?scope=personal,<slug>,…`;
 * see features/account/scope.ts). Only the person's own organizations count: anything else
 * asked for is ignored, and if nothing is left it means everything, never an empty page.
 */

export interface ServerScope {
  /** Nothing chosen: everything. */
  everything: boolean
  /** "personal" chosen: the platform's own (no organization). */
  personal: boolean
  /** Chosen organizations the person is in. */
  slugs: string[]
  /** Whether an item from this organization (null: from none) is in the scope. */
  includes: (orgSlug: string | null | undefined) => boolean
}

export function readServerScope(
  param: string | null | undefined,
  mine: readonly string[]
): ServerScope {
  const asked = (param ?? "").split(",").filter(Boolean)
  const personal = asked.includes("personal")
  const slugs = mine.filter((s) => asked.includes(s))
  const everything = !personal && slugs.length === 0
  return {
    everything,
    personal,
    slugs,
    includes: (orgSlug) =>
      everything || (orgSlug ? slugs.includes(orgSlug) : personal),
  }
}
