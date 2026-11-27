"use client"

import { useState } from "react"

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { Loading, PageTitle } from "@/features/admin/components/shell"

import { FeeReports } from "./fee-reports"
import { FeeStudents } from "./fee-students"
import { FeesSetup, useFeeSetup } from "./fees-setup"

/** Manage › Fees: students (collecting, ledgers), reports and setup. */
export function ManageFees({ slug }: { slug: string }) {
  const { data, error } = useFeeSetup(slug)
  const [tab, setTab] = useState<string | null>(null)
  if (!data) return <Loading error={error} />
  const first = data.can.collect || data.can.view ? "students" : "setup"
  return (
    <>
      <PageTitle>Fees</PageTitle>
      <Tabs value={tab ?? first} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-4">
          <TabsTrigger value="students">Students</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>
        <TabsContent value="students">
          <FeeStudents slug={slug} />
        </TabsContent>
        <TabsContent value="reports">
          <FeeReports slug={slug} />
        </TabsContent>
        <TabsContent value="setup">
          <FeesSetup slug={slug} />
        </TabsContent>
      </Tabs>
    </>
  )
}
