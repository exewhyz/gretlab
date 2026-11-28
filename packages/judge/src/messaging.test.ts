import assert from "node:assert/strict"
import { test } from "node:test"

import {
  allowanceLeft,
  composeSms,
  messageFailure,
  normalizePhone,
  smsSegments,
} from "./messaging.ts"
import { checkTwilioSignature, twilioSignature } from "./twilio.ts"

test("a phone number becomes E.164, an Indian 10-digit mobile with +91", () => {
  assert.equal(normalizePhone("98765 43210"), "+919876543210")
  assert.equal(normalizePhone("+91 98765-43210"), "+919876543210")
  assert.equal(normalizePhone("09876543210"), "+919876543210")
  assert.equal(normalizePhone("919876543210"), "+919876543210")
  assert.equal(normalizePhone("0044 20 7946 0958"), "+442079460958")
  assert.equal(normalizePhone("+1 (415) 867-5310"), "+14158675310")
})

test("what isn't a phone number is refused", () => {
  assert.equal(normalizePhone(""), null)
  assert.equal(normalizePhone("12345"), null)
  assert.equal(normalizePhone("98765abc10"), null)
  assert.equal(normalizePhone("+1234567890123456"), null)
  assert.equal(normalizePhone("1234567890"), null) // ten digits, but not a mobile
})

test("SMS segments: GSM-7 at 160 and 153, otherwise UCS-2 at 70 and 67", () => {
  assert.deepEqual(smsSegments("a".repeat(160)), { encoding: "gsm", units: 160, segments: 1 })
  assert.deepEqual(smsSegments("a".repeat(161)), { encoding: "gsm", units: 161, segments: 2 })
  assert.equal(smsSegments("a".repeat(306)).segments, 2)
  assert.equal(smsSegments("a".repeat(307)).segments, 3)
  // An extension character counts twice.
  assert.equal(smsSegments("€".repeat(80)).units, 160)
  assert.equal(smsSegments("₹ 500").encoding, "ucs2")
  assert.equal(smsSegments("न".repeat(70)).segments, 1)
  assert.equal(smsSegments("न".repeat(71)).segments, 2)
  assert.equal(smsSegments("").segments, 0)
})

test("an SMS is its wording with the values filled in, cut to two segments", () => {
  assert.equal(
    composeSms("{{org}}: {{name}} was absent on {{day}}.", {
      org: "First College",
      name: "Asha",
      day: "28 Nov",
    }),
    "First College: Asha was absent on 28 Nov."
  )
  // Values are filled after the wording is read: a value can't add a placeholder.
  assert.equal(composeSms("Hi {{name}}", { name: "{{org}}", org: "X" }), "Hi {{org}}")
  assert.equal(composeSms("Hi {{name}}, {{missing}}!", { name: "A" }), "Hi A, !")
  const long = composeSms("{{body}}", { body: "word ".repeat(200) })
  assert.equal(smsSegments(long).segments, 2)
  assert.ok(long.endsWith("..."))
  const unicode = composeSms("{{body}}", { body: "₹".repeat(500) })
  assert.equal(smsSegments(unicode).segments, 2)
})

test("a Twilio failure is retried, permanent, or the person opted out", () => {
  assert.equal(messageFailure({ status: 429, code: 20429 }), "retry")
  assert.equal(messageFailure({ status: 503, code: null }), "retry")
  assert.equal(messageFailure({ status: null, code: null }), "retry")
  // A wrong key is the operator's to fix: queued messages wait for it.
  assert.equal(messageFailure({ status: 401, code: 20003 }), "retry")
  assert.equal(messageFailure({ status: 400, code: 21610 }), "opted_out")
  assert.equal(messageFailure({ status: 400, code: 21211 }), "permanent")
  assert.equal(messageFailure({ status: 400, code: 63016 }), "permanent")
})

test("the allowance left this month, never below none", () => {
  assert.equal(allowanceLeft({ students: 100, perStudent: 2, used: 150 }), 50)
  assert.equal(allowanceLeft({ students: 100, perStudent: 2, used: 250 }), 0)
  assert.equal(allowanceLeft({ students: 0, perStudent: 2, used: 0 }), 0)
})

test("Twilio's signature, with the example from Twilio's security docs", () => {
  const url = "https://example.com/myapp.php?foo=1&bar=2"
  const params = {
    Digits: "1234",
    To: "+18005551212",
    From: "+14158675310",
    Caller: "+14158675310",
    CallSid: "CA1234567890ABCDE",
  }
  assert.equal(twilioSignature("12345", url, params), "L/OH5YylLD5NRKLltdqwSvS0BnU=")
  assert.equal(checkTwilioSignature("12345", url, params, "L/OH5YylLD5NRKLltdqwSvS0BnU="), true)
  assert.equal(checkTwilioSignature("12345", url, { ...params, Digits: "9999" }, "L/OH5YylLD5NRKLltdqwSvS0BnU="), false)
  assert.equal(checkTwilioSignature("wrong", url, params, "L/OH5YylLD5NRKLltdqwSvS0BnU="), false)
  assert.equal(checkTwilioSignature("12345", url, params, ""), false)
})
