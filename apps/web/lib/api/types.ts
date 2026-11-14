/*
 * Response types the browser can share with the server instead of writing them again:
 * `ApiResult<typeof serverFunction>` is what that function's route answers, as the browser
 * receives it (JSON: dates become strings). Import server functions only with `import type`,
 * so nothing of the server reaches the browser bundle.
 */

/** A value after a trip through JSON. */
export type Jsonified<T> = T extends Date
  ? string
  : T extends Set<unknown> | Map<unknown, unknown>
    ? Record<string, never>
    : T extends object
      ? // A mapped type keeps arrays and tuples ([input, output]) as they are.
        { [K in keyof T]: Jsonified<T[K]> }
      : T

/** What a route built on this server function answers. */
export type ApiResult<F extends (...args: never[]) => unknown> = Jsonified<
  Awaited<ReturnType<F>>
>
