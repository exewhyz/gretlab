---
title: Plans and billing
description: "Choose the features, students and staff your organization pays for, see the price as you choose, and pay monthly, per semester or yearly with GST invoices."
glance:
  who:
    - role: Owner and admin
      note: choose the plan, pay, download invoices
    - role: Platform owner
      note: sets prices, sets plans by hand, sees revenue
  where:
    path: /orgs/<slug>/manage/billing
    menu: "School › Plan and billing"
  permissions: [org.billing.manage, platform.billing.manage]
---

Each feature of GretLab has a price per student a year. Your organization pays for the features it
uses, for the number of students and staff it has. The platform switches billing on; until then
nothing is limited or charged.

## Your plan

**School › Plan and billing** shows your plan, what it costs, when it renews, and how many students
and staff you have against what the plan allows.

- **Students** are active members placed in a class or group who hold no staff role. **Staff** are
  members whose role grants something. Parents are never counted.
- At 90% of either, whoever manages billing is told. Past the limit you have **30 days** to add more
  before adding people pauses. Nothing already there stops working.
- A new organization starts on the **free plan**: Classes and the Coding lab, for 50 students and 5
  staff.
- Organizations that were on GretLab before billing keep every feature with no limits until their
  plan is set.

## Changing your plan

The builder lists every feature with its price a student. Start from a ready-made plan (Coding lab,
College, University, School, Coaching, Company training; only those your kind can use) or tick what you need. As you choose, it shows the
total, the price a student, GST and what's due now.

- **Volume steps** lower the price for large organizations, like tax slabs: 10% off students past
  300, 15% past 1,000, 20% past 3,000.
- **Staff:** one free for every 15 students, then each one charged.
- **Extras:** your own judge machines, and storage in 50 GB packs.
- Above **10,000 students**, contact GretLab for a quote.

A feature that needs another brings it along (Lab exams need the Coding lab). A feature not in your
plan is switched off, its pages leave the sidebar, and Settings › Modules shows it as "Not in your
plan".

## Paying

Pay **monthly**, **per semester** or **yearly**. Yearly is the list price; a semester is half of it
plus 10%; a month is a twelfth of it plus 25%. Payments go through Razorpay: UPI, cards or net
banking. GretLab never sees your card or bank details.

- **A period starts the day you pay.** Payments aren't refunded.
- **Adding** features, students or staff during a period costs only the days left in it, and
  applies at once.
- **Removing or lowering** anything waits for your next period: nothing is refunded, and you keep
  it until then. A change that does both is split: what it adds applies now (and is all you pay
  for), what it removes waits. The page's **What changes** panel shows both before you pay.
- **A smaller plan** costs nothing now and starts at your next period; the page shows it, renewing
  starts from it, and **Keep my current plan** cancels it.
- **The same plan again** is refused while it's in force. If you open payment in two tabs, the
  same change shares one payment; a different change replaces the first, and a replaced payment
  that goes through anyway isn't applied and is refunded.
- **A referral code or coupon:** type it and press **Apply** to see each discount and what's left
  to pay, with GST, before anything is charged, or why the code can't be used. One code at a time:
  **Remove** it to try another. Which organizations a code is for, and whether it adds to the
  discount from the link you came through, are in [Refer and earn](/features/platform/referrals/).
- **Only what your kind of organization can use** is offered: a college isn't sold assigned
  training, a company isn't sold hostels. Those show as "Not for a …".
- **Monthly, semester or yearly** can be changed in the week before your period renews.
- You're reminded **a week and a day** before your period ends. Unpaid, the plan is past due for 7
  days, then paused: adding members and staff roles stops until it's paid. Work, records and grades
  stay as they are, and paying restores everything at once.

## Invoices and GST

Enter your organization's legal name, GSTIN, address and billing email under **Billing details**;
they go on your invoices. With a GSTIN in GretLab's state, GST is charged as CGST and SGST; from
another state, or without one, as IGST. Every payment has an invoice, numbered per financial year
(`GL/2026-27/000001`), under **Payments and invoices** as a PDF.

## For the platform

**Dashboard › Plans** (the platform owner):

- **Organizations:** every organization's plan and use. **Set plan** sets one by hand, for a quote,
  a pilot or a payment taken outside GretLab, with a discount if agreed. Each change is in the
  activity log.
- **Revenue:** what each organization's plan brings in a month against what its judging costs this
  month. That cost is its own judge machines, as Dashboard › Costs counts them, plus a share of the
  shared ones by its submissions. Organizations that cost more than they pay are flagged. Judge
  machines are billed in US dollars, converted at the rate set under Prices.
- **Prices:** billing on or off, each feature's price, staff, steps, period surcharges, the free
  plan, GST and your GSTIN. New prices apply to the next payment; a period already paid for keeps its
  price.

Setting up Razorpay (keys and the webhook) is in the README, under **Payments (Razorpay)**.
