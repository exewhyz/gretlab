import { z } from "zod"

import { route } from "@/lib/api/route"
import { listStaff, setStaffRole } from "@/features/platform/staff"

/** Everyone with platform access, and their role. */
export const GET = route({ access: "platform.roles.manage" }, ({ user }) => listStaff(user))

/** Gives someone a platform role: a built-in key or a custom role's id. */
export const PUT = route(
  {
    access: "platform.roles.manage",
    body: z.object({ email: z.email(), role: z.string().min(1).max(64) }),
  },
  ({ user, body }) => setStaffRole(user, body)
)
