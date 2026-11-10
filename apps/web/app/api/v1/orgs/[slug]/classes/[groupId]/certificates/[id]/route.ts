import { route } from "@/lib/api/route"
import { revokeCertificate } from "@/features/certificates/server"

/** Revokes it: the record stays, and its public page says it was revoked. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  revokeCertificate(params.slug ?? "", user, params.groupId ?? "", params.id ?? "")
)
