---
title: The organization API
description: API keys for an organization's own API, the endpoints to start with, paged lists, and signed webhooks.
---

Gretlab's web app and other systems use the same API, at `/api/v1`. This guide covers what another system needs:

- a key to call an organization's API;
- the endpoints it's most likely to want;
- webhooks, which tell it what changed.

Keys and webhooks are under **Manage › Integrations**. Only people who manage the organization's settings across the whole organization see that page.

## API keys

- **One system, one key.** Make a key for each system that connects, so you can revoke one without the others. A key:
  - belongs to one organization, and only works on its addresses (`/api/v1/orgs/<slug>/…`);
  - acts as the person who made it, but only with the permissions chosen for it, and only those that person holds across the organization;
  - is shown once, when made. Gretlab keeps only a fingerprint (SHA-256), so a lost key can't be recovered: make a new one;
  - can be revoked at any time, and stops working at once;
  - appears in the activity log by name, for every change it makes. Its maker's name is there too ("Name <email>, API key "SIS"").
- **Sending it.** Every request carries it as a bearer token:

```
GET /api/v1/orgs/greenwood/members?page=1
Authorization: Bearer glk_3fa9c01b2e_…
```

- **What a key can't do:**
  - use the platform's addresses, anyone's own account addresses (`/me`), or another organization's;
  - make or change keys and webhooks, which needs a signed-in person.
- **Answers:**

| Status | Means |
| --- | --- |
| 401 `invalid_api_key` | Not a key, or it was revoked. |
| 403 | The key may not do this. |
| 404 | Not found, or another organization's. |

### Errors

Every error is JSON:

```json
{ "error": { "code": "forbidden", "message": "This needs the \"See members\" permission." } }
```

An unexpected failure is a 500 with a short `ref`. Quote it to the people who run Gretlab: the same `ref` is in the server log.

### Endpoints to start with

All under `/api/v1/orgs/<slug>`. Each needs the permission in brackets.

| Method and path | What |
| --- | --- |
| `GET /members?page=1&kind=learner` | Members, 100 a page, with counts by kind (staff, learner, parent, other) [See members] |
| `GET /members` | Everyone at once [See members] |
| `GET /groups` | Classes, sections, teams and how they nest [See members] |
| `GET /students?page=1` | Student records with admission numbers [See student records] |
| `GET /attendance/overview?month=2026-11` | Every class's month: days taken, share present, how many below the minimum [See attendance] |
| `GET /attendance/month?groupId=…&month=2026-11` | One class's month, mark by mark [See attendance] |
| `GET /holidays` | Days the organization is closed (anyone in it) |
| `GET /reports?part=figures` | The figures: summary, assignments, teaching [See reports] |
| `GET /reports?page=1&inactive=true` | Students' activity and assignment results, 100 a page [See reports] |
| `GET /reports` | The whole report at once [See reports] |
| `GET /assignments/<id>/gradebook?format=csv` | A gradebook as CSV [See grades] |

### Paged lists

Lists that can grow long take `?page=` (from 1), with `?q=` to search and `?perPage=` (up to 200) to change the page size. A paged answer always has:

```json
{ "items": […], "total": 180, "page": 1, "pages": 2, "perPage": 100 }
```

A page past the end answers with the last page. Some lists also repeat `items` under an older name (`members`, `links`, `students`). Without `?page`, they answer the whole list. A `page` or `perPage` that isn't a number in range is a 400 `invalid_query`.

The same paths change things too (POST, PUT, PATCH, DELETE), with the matching permissions. A key may change whatever its permissions allow.

## Webhooks

- **What gets sent.** A webhook posts each change you choose to an address of yours, as it happens. Changes are what the activity log records:
  - `leave.decide`, `member.add`, `exam.publish`, `holiday.add` and so on;
  - "Everything" (`*`), or whole areas (`leave.*`, `member.*`).
- **The address.** It must be `https` and public, not one on the server's own machine or a private network.

### A delivery

```
POST https://example.com/hooks/gretlab
Content-Type: application/json
Gretlab-Event: leave.decide
Gretlab-Delivery: 6f1c…
Gretlab-Signature: t=1794631200,v1=9e2b…

{
  "id": "6f1c…",
  "event": "leave.decide",
  "at": "2026-11-14T10:00:00.000Z",
  "organization": "c41d…",
  "summary": "Approved Imran Naidu's leave (sick, 1 day)",
  "actor": { "id": "a7e0…", "label": "Shreya Shah <shreya.shah@…>" },
  "detail": { "…": "what the activity log has" }
}
```

- **Answering.** Answer with any 2xx within 10 seconds; do slow work afterwards.
- **Retries.** Anything else, or no answer, is tried again after 1, 5 and 15 minutes, then 1, 3, 8 and 24 hours. After eight tries Gretlab gives up and shows "Gave up".
- **Duplicates.** A delivery can arrive more than once. Use `Gretlab-Delivery` (the same as `id`) to skip one you've already handled.
- **Checking the setup.** "Send a test" on the Integrations page sends an `event: "ping"` delivery.

### Checking the signature

- **The signing secret.** Each webhook has one (`whsec_…`), shown once when it's added.
- **The signature.** `v1` is the HMAC-SHA256, in hex, of `<t>.<raw body>`, keyed with the secret. Recompute it and compare in constant time.
- **The time.** Refuse a `t` more than five minutes from now.

```js
import { createHmac, timingSafeEqual } from "node:crypto"

function fromGretlab(secret, rawBody, header) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")))
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest()
  const given = Buffer.from(v1 ?? "", "hex")
  return given.length === expected.length && timingSafeEqual(given, expected)
}
```
