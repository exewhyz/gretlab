/*
 * LTI 1.3 launch checks, after the signature: who it's from, for whom, when, and what it
 * asks. Pure; the server verifies the RS256 signature against the LMS's keys first.
 * Spec: IMS LTI Core 1.3 and its security framework.
 */

export const LTI = {
  messageType: "https://purl.imsglobal.org/spec/lti/claim/message_type",
  version: "https://purl.imsglobal.org/spec/lti/claim/version",
  deploymentId: "https://purl.imsglobal.org/spec/lti/claim/deployment_id",
  targetLinkUri: "https://purl.imsglobal.org/spec/lti/claim/target_link_uri",
  resourceLink: "https://purl.imsglobal.org/spec/lti/claim/resource_link",
  roles: "https://purl.imsglobal.org/spec/lti/claim/roles",
  context: "https://purl.imsglobal.org/spec/lti/claim/context",
  custom: "https://purl.imsglobal.org/spec/lti/claim/custom",
  ags: "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint",
  deepLinking: "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings",
  contentItems: "https://purl.imsglobal.org/spec/lti-dl/claim/content_items",
  dlData: "https://purl.imsglobal.org/spec/lti-dl/claim/data",
  scoreScope: "https://purl.imsglobal.org/spec/lti-ags/scope/score",
} as const

export interface LaunchExpectations {
  issuer: string
  clientId: string
  deploymentIds: readonly string[]
  nonce: string
  /** Seconds since the epoch. */
  now: number
}

export type LaunchKind = "resource" | "deep_link"

/** Seconds of clock difference allowed between the LMS and us. */
const SKEW = 60

export function checkLaunch(
  claims: Record<string, unknown>,
  expect: LaunchExpectations
): { kind: LaunchKind } | { error: string } {
  if (claims.iss !== expect.issuer) return { error: "It came from a different LMS than the one registered." }
  const aud = claims.aud
  const audiences = Array.isArray(aud) ? aud : [aud]
  if (!audiences.includes(expect.clientId)) return { error: "It wasn't meant for this tool." }
  if (audiences.length > 1 && claims.azp !== expect.clientId) return { error: "It wasn't meant for this tool." }
  if (typeof claims.exp !== "number" || claims.exp + SKEW < expect.now) return { error: "The launch has expired. Open it again from your course." }
  if (typeof claims.iat !== "number" || claims.iat - SKEW > expect.now) return { error: "The launch's time is wrong." }
  if (claims.nonce !== expect.nonce) return { error: "The launch doesn't match its sign-in. Open it again from your course." }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return { error: "The LMS didn't say who you are." }
  if (claims[LTI.version] !== "1.3.0") return { error: "Only LTI 1.3 launches are supported." }
  const deployment = claims[LTI.deploymentId]
  if (typeof deployment !== "string" || !expect.deploymentIds.includes(deployment)) {
    return { error: "This LMS deployment isn't registered. Ask your admin to add its deployment ID." }
  }
  const type = claims[LTI.messageType]
  if (type === "LtiResourceLinkRequest") {
    const link = claims[LTI.resourceLink] as { id?: unknown } | undefined
    if (!link || typeof link.id !== "string") return { error: "The launch has no resource link." }
    return { kind: "resource" }
  }
  if (type === "LtiDeepLinkingRequest") {
    const settings = claims[LTI.deepLinking] as { deep_link_return_url?: unknown } | undefined
    if (!settings || typeof settings.deep_link_return_url !== "string") return { error: "The deep linking request has nowhere to return to." }
    return { kind: "deep_link" }
  }
  return { error: "That kind of LTI message isn't supported." }
}

const INSTRUCTOR = [
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
  "http://purl.imsglobal.org/vocab/lis/v2/membership#ContentDeveloper",
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator",
  "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor",
  "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator",
  "Instructor",
]

/** Teaches the course in the LMS (instructor, content developer, admin); otherwise a learner. */
export const isInstructor = (roles: unknown) =>
  Array.isArray(roles) &&
  roles.some((r) => typeof r === "string" && INSTRUCTOR.some((i) => r === i || r.startsWith(`${i}#`)))

/** The scores endpoint of a line item: its path plus /scores, keeping any query. */
export function scoresUrl(lineItem: string) {
  const url = new URL(lineItem)
  url.pathname = url.pathname.replace(/\/$/, "") + "/scores"
  return url.toString()
}
