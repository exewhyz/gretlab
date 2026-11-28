import assert from "node:assert/strict"
import { test } from "node:test"

import {
  deliveryFor,
  effectivePolicy,
  messagingFor,
  type EventDefinition,
  eventOfKind,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  policyOverridesSchema,
  readOverrides,
  readPreferences,
  wantsEmail,
  weeklyDigestKey,
} from "./notifications.ts"

const everyone = { emailOn: true, events: {} }

test("every kind belongs to exactly one event", () => {
  const kinds = NOTIFICATION_EVENT_KEYS.flatMap((e) => [
    ...NOTIFICATION_EVENTS[e].kinds,
  ])
  assert.equal(new Set(kinds).size, kinds.length)
  assert.equal(eventOfKind("new_exam"), "assignment.published")
  assert.equal(eventOfKind("project_marked"), "feedback.released")
  assert.equal(eventOfKind("made_up"), null)
})

test("with nothing changed, everything is on and nothing is locked", () => {
  const p = effectivePolicy("class.notice", {}, {})
  assert.deepEqual(
    { inApp: p.inApp, email: p.email, userChoice: p.userChoice },
    { inApp: true, email: true, userChoice: true }
  )
  assert.deepEqual(p.lockedByPlatform, {
    inApp: false,
    email: false,
    userChoice: false,
    // Messages are off until the platform switches them on.
    sms: true,
    whatsapp: true,
  })
})

test("what the platform turns off, an organization can't turn on", () => {
  const platform = { "class.notice": { email: false } }
  const p = effectivePolicy("class.notice", platform, {
    "class.notice": { email: true },
  })
  assert.equal(p.email, false)
  assert.equal(p.lockedByPlatform.email, true)
  assert.equal(p.inApp, true)
})

test("an organization narrows what the platform allows, for itself only", () => {
  const org = { "class.notice": { email: false, userChoice: false } }
  const inOrg = effectivePolicy("class.notice", {}, org)
  assert.equal(inOrg.email, false)
  assert.equal(inOrg.userChoice, false)
  assert.equal(inOrg.lockedByPlatform.email, false)
  // The platform's own work (no organization) isn't affected.
  assert.equal(effectivePolicy("class.notice", {}, null).email, true)
})

test("an email-only event never appears in the bell", () => {
  assert.equal(effectivePolicy("staff.weekly_digest", {}, {}).inApp, false)
})

test("a person's choice: their main switch, then the event, then its default", () => {
  assert.equal(wantsEmail("class.notice", everyone), true)
  assert.equal(wantsEmail("staff.assignment_published", everyone), false)
  assert.equal(
    wantsEmail("staff.assignment_published", {
      emailOn: true,
      events: { "staff.assignment_published": true },
    }),
    true
  )
  assert.equal(
    wantsEmail("class.notice", {
      emailOn: true,
      events: { "class.notice": false },
    }),
    false
  )
  assert.equal(
    wantsEmail("class.notice", {
      emailOn: false,
      events: { "class.notice": true },
    }),
    false
  )
})

test("delivery: the policy decides, the person only where they're given the choice", () => {
  const on = { inApp: true, email: true, userChoice: true, sms: false, whatsapp: false }
  const optedOut = { emailOn: false, events: {} }
  assert.deepEqual(deliveryFor("class.notice", on, everyone), {
    inApp: true,
    email: true,
  })
  assert.deepEqual(deliveryFor("class.notice", on, optedOut), {
    inApp: true,
    email: false,
  })
  // Without the choice it goes to everyone, even someone who turned email off.
  assert.deepEqual(
    deliveryFor("class.notice", { ...on, userChoice: false }, optedOut),
    { inApp: true, email: true }
  )
  // Email turned off above: nobody gets it, whatever they chose.
  assert.deepEqual(
    deliveryFor(
      "class.notice",
      { inApp: false, email: false, userChoice: false, sms: false, whatsapp: false },
      everyone
    ),
    { inApp: false, email: false }
  )
})

test("only known events and switches can be saved", () => {
  assert.equal(
    policyOverridesSchema.safeParse({ "class.notice": { email: false } })
      .success,
    true
  )
  assert.equal(
    policyOverridesSchema.safeParse({ "made.up": { email: false } }).success,
    false
  )
  assert.equal(
    policyOverridesSchema.safeParse({ "class.notice": { pigeon: true } }).success,
    false
  )
  assert.equal(
    policyOverridesSchema.safeParse({ "class.notice": { sms: true, whatsapp: false } }).success,
    true
  )
  assert.deepEqual(readOverrides("garbage"), {})
  assert.deepEqual(readOverrides(null), {})
  assert.deepEqual(readPreferences({ "class.notice": false }), {
    "class.notice": false,
  })
  assert.deepEqual(readPreferences({ nope: true }), {})
})

test("the weekly summary's week: the latest Monday whose 08:00 has passed, locally", () => {
  // Monday 2026-11-09, in India (UTC+5:30).
  const tz = "Asia/Kolkata"
  assert.equal(
    weeklyDigestKey(new Date("2026-11-09T02:00:00Z"), tz),
    "2026-11-02"
  ) // 07:30 Mon
  assert.equal(
    weeklyDigestKey(new Date("2026-11-09T02:30:00Z"), tz),
    "2026-11-09"
  ) // 08:00 Mon
  assert.equal(
    weeklyDigestKey(new Date("2026-11-11T12:00:00Z"), tz),
    "2026-11-09"
  ) // Wed
  assert.equal(
    weeklyDigestKey(new Date("2026-11-15T18:00:00Z"), tz),
    "2026-11-09"
  ) // Sun 23:30
  assert.equal(
    weeklyDigestKey(new Date("2026-11-15T19:00:00Z"), tz),
    "2026-11-09"
  ) // Mon 00:30
  // The same instant is a different local day elsewhere.
  assert.equal(
    weeklyDigestKey(new Date("2026-11-09T02:30:00Z"), "America/New_York"),
    "2026-11-02"
  )
  // Across a month and a year boundary.
  assert.equal(
    weeklyDigestKey(new Date("2027-01-01T12:00:00Z"), "UTC"),
    "2026-12-28"
  )
})

test("SMS and WhatsApp are off until both the platform and the organization switch them on", () => {
  assert.equal(effectivePolicy("parent.absence", {}, {}).sms, false)
  const platform = { "parent.absence": { sms: true } }
  assert.equal(effectivePolicy("parent.absence", platform, {}).sms, false)
  const both = effectivePolicy("parent.absence", platform, { "parent.absence": { sms: true } })
  assert.equal(both.sms, true)
  assert.equal(both.lockedByPlatform.sms, false)
  assert.equal(both.whatsapp, false)
  // The platform's own work follows the platform alone.
  assert.equal(effectivePolicy("parent.absence", platform, null).sms, true)
  // An organization can't turn on what the platform hasn't.
  assert.equal(effectivePolicy("parent.absence", {}, { "parent.absence": { sms: true } }).sms, false)
})

test("only events marked for messaging can go by SMS or WhatsApp", () => {
  const on = { "staff.weekly_digest": { sms: true, whatsapp: true } }
  const p = effectivePolicy("staff.weekly_digest", on, on)
  assert.equal(p.sms, false)
  assert.equal(p.whatsapp, false)
  assert.ok(NOTIFICATION_EVENT_KEYS.filter((e) => (NOTIFICATION_EVENTS[e] as EventDefinition).messaging).includes("fees.update"))
})

test("a person gets a message only on a channel they opted in to, for events they kept on", () => {
  const policy = { inApp: true, email: true, userChoice: true, sms: true, whatsapp: true }
  const prefs = { emailOn: true, events: {} }
  assert.deepEqual(messagingFor("fees.update", policy, { sms: true, whatsapp: false }, prefs), { sms: true, whatsapp: false })
  assert.deepEqual(
    messagingFor("fees.update", policy, { sms: true, whatsapp: true }, { emailOn: false, events: { "fees.update": false } }),
    { sms: false, whatsapp: false }
  )
  assert.deepEqual(
    messagingFor("fees.update", { ...policy, sms: false }, { sms: true, whatsapp: true }, prefs),
    { sms: false, whatsapp: true }
  )
})
