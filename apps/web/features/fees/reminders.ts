import {
  feePlans,
  feeRemindersSent,
  getDb,
  organizations,
  sql,
} from "@workspace/db"
import { reminderStep } from "@workspace/judge"

import { today } from "@/features/catalog/server"
import { notifyEach } from "@/features/notifications/server"
import { modulesOf } from "@/features/orgs/kinds"
import { orgPages } from "@/lib/paths"

import { orgLedgers } from "./batch"

const { inArray } = sql

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`

const WORDS: Record<string, (label: string, plan: string) => string> = {
  soon: (label, plan) => `${plan}: ${label} is due in a few days`,
  due: (label, plan) => `${plan}: ${label} is due`,
}

/**
 * Fee reminders, from the daily cron: for each instalment still owed, 3 days before, on the
 * day, then weekly while it's owed (reminderStep). Each step goes once per student and
 * instalment (fee_reminders_sent), to the student and, copied, their parents.
 */
export async function sendFeeReminders() {
  const db = getDb()
  const day = await today()
  const orgIds = (
    await db.selectDistinct({ orgId: feePlans.orgId }).from(feePlans)
  ).map((r) => r.orgId)
  if (orgIds.length === 0) return { sent: 0 }
  const orgs = await db
    .select()
    .from(organizations)
    .where(inArray(organizations.id, orgIds))
  let sent = 0
  for (const org of orgs) {
    if (!org.active || !(await modulesOf(org)).has("finance")) continue
    const due: {
      studentId: string
      planId: string
      instalmentId: string
      step: string
      title: string
      body: string
    }[] = []
    for (const row of await orgLedgers(org.id, day)) {
      for (const inst of row.ledger.instalments) {
        const step = reminderStep(inst.dueOn, day, inst.balance)
        if (!step) continue
        due.push({
          studentId: row.studentId,
          planId: row.planId,
          instalmentId: inst.id,
          step,
          title: (
            WORDS[step] ??
            ((label: string, plan: string) => `${plan}: ${label} is overdue`)
          )(inst.label, row.planName),
          body: `${rupees(inst.balance)} owed${inst.overdue ? `, ${inst.daysOverdue} days late` : ""}.`,
        })
      }
    }
    if (due.length === 0) continue
    // Claim each step once (another cron at the same moment claims nothing twice).
    const claimed = await db
      .insert(feeRemindersSent)
      .values(
        due.map(({ studentId, planId, instalmentId, step }) => ({
          studentId,
          planId,
          instalmentId,
          step,
        }))
      )
      .onConflictDoNothing()
      .returning()
    const fresh = new Set(
      claimed.map(
        (c) => `${c.planId}:${c.studentId}:${c.instalmentId}:${c.step}`
      )
    )
    const items = due
      .filter((d) =>
        fresh.has(`${d.planId}:${d.studentId}:${d.instalmentId}:${d.step}`)
      )
      .map((d) => ({
        userId: d.studentId,
        title: d.title,
        body: d.body,
        href: orgPages(org.slug).fees("me"),
      }))
    if (items.length) await notifyEach("fee_due", org.id, items)
    sent += items.length
  }
  return { sent }
}
