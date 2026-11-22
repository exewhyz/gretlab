import type { Metadata } from "next"

import { MonitoringPage } from "@/features/monitoring/components/monitoring-page"

export const metadata: Metadata = { title: "Monitoring" }

export default function Page() {
  return <MonitoringPage />
}
