import assert from "node:assert/strict"
import { test } from "node:test"

import { checkIdToken, emailDomain, ssoDomainProblem } from "./sso.ts"

const now = 1_800_000_000
const expect = {
  issuer: "https://login.example.edu",
  clientId: "gretlab",
  nonce: "n-123",
  domains: ["college.edu", "staff.college.edu"],
  now,
}
const good = {
  iss: "https://login.example.edu",
  aud: "gretlab",
  sub: "user-42",
  exp: now + 300,
  iat: now - 5,
  nonce: "n-123",
  email: "Asha@College.edu",
  name: "Asha Rao",
}

test("a good token: who it is, with the email lower-cased", () => {
  assert.deepEqual(checkIdToken(good, expect), {
    sub: "user-42",
    email: "asha@college.edu",
    name: "Asha Rao",
  })
})

test("the wrong issuer, audience or nonce is refused", () => {
  assert.ok(
    "error" in checkIdToken({ ...good, iss: "https://evil.example" }, expect)
  )
  assert.ok("error" in checkIdToken({ ...good, aud: "someone-else" }, expect))
  assert.ok(
    "error" in checkIdToken({ ...good, aud: ["gretlab", "other"] }, expect),
    "several audiences need azp"
  )
  assert.ok(
    !(
      "error" in
      checkIdToken(
        { ...good, aud: ["gretlab", "other"], azp: "gretlab" },
        expect
      )
    )
  )
  assert.ok("error" in checkIdToken({ ...good, nonce: "replayed" }, expect))
})

test("expired or from the future, past a minute's skew, is refused", () => {
  assert.ok("error" in checkIdToken({ ...good, exp: now - 61 }, expect))
  assert.ok(!("error" in checkIdToken({ ...good, exp: now - 30 }, expect)))
  assert.ok("error" in checkIdToken({ ...good, iat: now + 120 }, expect))
  assert.ok("error" in checkIdToken({ ...good, exp: undefined }, expect))
})

test("the email must be on one of the college's domains: never another's account", () => {
  assert.ok(
    "error" in checkIdToken({ ...good, email: "someone@gmail.com" }, expect)
  )
  assert.ok(
    "error" in checkIdToken({ ...good, email: "x@evilcollege.edu" }, expect),
    "not a suffix match"
  )
  assert.ok(
    !(
      "error" in checkIdToken({ ...good, email: "t@staff.college.edu" }, expect)
    )
  )
  assert.ok(
    "error" in checkIdToken({ ...good, email: "x@sub.college.edu" }, expect),
    "subdomains only when listed"
  )
})

test("Microsoft's preferred_username stands in when there's no email claim", () => {
  const { email: _e, ...noEmail } = good
  const result = checkIdToken(
    { ...noEmail, preferred_username: "Ravi@college.edu" },
    expect
  )
  assert.equal("email" in result && result.email, "ravi@college.edu")
  assert.ok("error" in checkIdToken({ ...noEmail }, expect))
})

test("an email the IdP marks unverified is refused", () => {
  assert.ok("error" in checkIdToken({ ...good, email_verified: false }, expect))
})

test("a missing subject is refused", () => {
  assert.ok("error" in checkIdToken({ ...good, sub: "" }, expect))
})

test("domains platform staff can give a college: real ones, never public mail", () => {
  assert.equal(ssoDomainProblem("college.edu"), null)
  assert.equal(ssoDomainProblem("staff.college.ac.in"), null)
  assert.match(ssoDomainProblem("gmail.com")!, /public/)
  assert.match(ssoDomainProblem("outlook.com")!, /public/)
  assert.match(ssoDomainProblem("not a domain")!, /domain/)
  assert.match(ssoDomainProblem("localhost")!, /domain/)
  assert.equal(emailDomain(" A@College.EDU "), "college.edu")
  assert.equal(emailDomain("nope"), null)
})
