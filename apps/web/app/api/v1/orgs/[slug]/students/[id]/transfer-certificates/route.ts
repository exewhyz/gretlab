import { route } from "@/lib/api/route"
import {
  issueTransferCertificate,
  tcSchema,
  transferCertificatesOf,
} from "@/features/records/server"

/** A student's transfer certificates. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  transferCertificatesOf(params.slug ?? "", user, params.id ?? "")
)

/** Issues one (and marks them transferred, unless asked not to). */
export const POST = route(
  { access: "user", body: tcSchema },
  ({ user, params, body }) =>
    issueTransferCertificate(params.slug ?? "", user, params.id ?? "", body)
)
