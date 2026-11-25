import { route } from "@/lib/api/route"
import { startVirtual, virtualStatus } from "@/features/contests/virtual"

/** The viewer's virtual attempt at a contest that has ended: whether they may take it, or where it stands. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  virtualStatus(params.slug ?? "", user)
)

/** Starts the viewer's one virtual attempt, now. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  startVirtual(params.slug ?? "", user)
)
