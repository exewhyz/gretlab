---
title: Fees
description: Fee heads and yearly plans in instalments, concessions, late fines, collecting at the counter with numbered receipts, online payment into your own Razorpay account, reminders and fee reports.
glance:
  who:
    - role: Accountant
      note: sets up fees, collects, gives concessions, reads reports
    - role: Student or parent
      note: sees what's due, pays online, downloads receipts
  where:
    path: /orgs/<slug>/manage/fees
    menu: "Fees › Fees"
  permissions: [fees.manage, fees.setup, fees.collect, fees.concede, fees.view]
  module: finance
---

Fees students pay your institution: a college's, a university's or a coaching institute's. It's
off until switched on in Settings › Modules. (GretLab's own plans for your organization are a
different thing: [Plans and billing](/features/platform/plans-and-billing/).)

## Setting up

Under **Fees › Setup** (Set up fees, across the organization):

- **Fee heads:** what fees are for: tuition, exam, library, hostel, transport. A head can include
  GST (coaching fees usually carry 18%; most college fees carry none), and can be charged to
  everyone on a plan, or only to hostel residents or bus riders.
- **Fee plans:** one per academic year for the classes you choose (a department covers its
  batches). A plan is a list of instalments, each with a due day and an amount per head, and an
  optional late fine charged once if it isn't paid by a number of days after the due day.
- **Receipts and online payments:** a receipt prefix (receipts are numbered per financial year:
  `GPC/2026-27/000001`), the GSTIN shown on receipts, and your own Razorpay keys. Money paid online
  goes straight to your Razorpay account, never through GretLab. The key secret and webhook secret
  are stored sealed and never shown again; leave them empty to keep them.

To take payments online, add a webhook in your Razorpay dashboard: the address
`https://<your GretLab site>/api/razorpay/fees/<your organization's address>`, the events
`payment.captured` and `order.paid`, and the webhook secret you saved here.

## Collecting

Under **Fees › Students**, find a student and open their fees: each instalment's fee, concession,
fine, what's paid and what's owed, days late, and their receipts.

- **Collect** records a payment at the counter: cash, cheque, demand draft, UPI or bank transfer
  (a reference is needed for all but cash). It pays the oldest dues first, the fine last, and
  never more than is owed. The receipt opens to print.
- **Concessions:** a percent or an amount, off one head or the whole plan, with a reason (merit,
  scholarship, sibling, staff ward, other). A head's own concessions come off first, then the
  plan's.
- **Cancel** a receipt (a bounced cheque, a mistake) with a reason. It keeps its number, is marked
  cancelled, and what it paid is owed again. You'll be asked for a sign-in code.

Collectors and concessions can be limited to some classes: give the role for those groups only.

## Students and parents

Students find **Fees** in their sidebar; parents open it from their child's page (with Parent
accounts on). They see what's owed and overdue, the next due day, each instalment, and their
receipts to download, and can **Pay online** when your Razorpay keys are set. Reminders come 3 days
before an instalment is due, on the day, then weekly while it's owed, with a copy to parents, and a
notice whenever a payment is received.

## Reports

**Fees › Reports** (See fees): collection over a range of days (by mode, head and collector, and
every receipt), dues and defaulters (worst first, by class, overdue only), and concessions given.
Each downloads as CSV. Staff whose roles cover some classes see only those students.

## Edge cases

- A head a plan uses can't be removed; a plan anyone has paid on can't be deleted.
- Two counters can't take the same dues at once; an online payment is applied once, whether the
  checkout or the webhook answers first.
- If the counter took dues while an online payment was open, what's beyond them is kept as an
  advance on the receipt.

## Related

- [Student records](/features/people/student-records/)
- [Parent accounts](/features/people/parent-accounts/)
- [Hostel](/features/campus/hostel/) and [Transport](/features/campus/transport/)
