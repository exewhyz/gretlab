"use client"

import { PageTitle } from "@/features/admin/components/shell"

import { FeesSetup } from "./fees-setup"

/** Manage › Fees. Setup now; the students' ledgers and reports come in the next slices. */
export function ManageFees({ slug }: { slug: string }) {
  return (
    <>
      <PageTitle>Fees</PageTitle>
      <FeesSetup slug={slug} />
    </>
  )
}
