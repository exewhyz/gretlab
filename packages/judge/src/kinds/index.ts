import { coaching } from "./coaching.ts"
import { cohort } from "./cohort.ts"
import { college } from "./college.ts"
import { community } from "./community.ts"
import { company } from "./company.ts"
import { other } from "./other.ts"
import { school } from "./school.ts"
import type { KindDefinition } from "./types.ts"

export type { KindDefinition, KindTerms, ModuleLevel } from "./types.ts"

/**
 * Every kind of organization, in the order they're offered. To add one: write its file
 * here, add it to this list, and add its key to the org_type enum (a migration). Order
 * and keys must match ORG_TYPES below.
 */
export const KINDS = {
  school,
  college,
  coaching,
  cohort,
  company,
  community,
  other,
} as const satisfies Record<string, KindDefinition>
