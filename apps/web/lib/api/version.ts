import { z } from "zod"

/**
 * The version a form was opened at (the record's `updatedAt`). Safe in the browser: the
 * check itself is server-only, in lib/api/conflict.ts.
 */
export const expectedUpdatedAt = z.coerce.date().optional()
