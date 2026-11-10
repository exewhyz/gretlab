import { route } from "@/lib/api/route"
import { issueSchema } from "@/features/certificates/schemas"
import { classCertificates, issueCertificates } from "@/features/certificates/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  classCertificates(params.slug ?? "", user, params.groupId ?? "")
)

/** For finishing one of the class's courses, or one written for chosen students. */
export const POST = route({ access: "user", body: issueSchema }, ({ user, params, body }) =>
  issueCertificates(params.slug ?? "", user, params.groupId ?? "", body)
)
