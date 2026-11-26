import { contestReplay, replayQuery } from "@/features/contests/replay"
import { route } from "@/lib/api/route"
import { ApiError } from "@/lib/api/errors"

/** ?user=<id>&problem=<label>: how that contestant's code was written, for whoever runs it. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const parsed = replayQuery.safeParse(Object.fromEntries(query))
  if (!parsed.success)
    throw new ApiError(400, "bad_request", "Say which contestant and problem.")
  return contestReplay(params.slug ?? "", user, parsed.data)
})
