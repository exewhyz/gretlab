"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { KINDS } from "@workspace/judge"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { api } from "@/lib/api/client"

import { AdminHome } from "./home-admin"
import { ParentHome, StudentHome } from "./home-member"
import { Home, TermsContext, UpcomingEvents, View } from "./home-parts"
import { StaffHome } from "./home-staff"
import { TeacherHome } from "./home-teacher"

const LABEL: Record<View, string> = {
  admin: "School",
  teacher: "Teaching",
  student: "My progress",
  parent: "My children",
  staff: "My work",
}

/** The school's home: a dashboard for each of this person's views here (tabs if several). */
export function OrgHome({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "home"],
    queryFn: () => api<Home>(`/orgs/${slug}/home`),
  })
  const shown = data?.views ?? []
  const [picked, setPicked] = useState<View | null>(null)
  if (error)
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {error.message}
      </p>
    )
  if (!data) return <HomeSkeleton />
  const view = picked && shown.includes(picked) ? picked : shown[0]
  return (
    <TermsContext.Provider value={data.terms ?? KINDS.school.terms}>
      <div className="grid gap-5" data-testid="org-home">
        {shown.length > 1 && (
          <Tabs value={view} onValueChange={(v) => setPicked(v as View)}>
            <TabsList aria-label="Show my home as">
              {shown.map((v) => (
                <TabsTrigger key={v} value={v}>
                  {LABEL[v]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        {view === "admin" && data.admin && (
          <AdminHome slug={slug} data={data.admin} />
        )}
        {view === "teacher" && data.teacher && (
          <TeacherHome
            slug={slug}
            data={data.teacher}
            runs={data.runs ?? null}
            training={data.training?.team ?? null}
          />
        )}
        {(view === "teacher" || view === "admin") &&
          data.events &&
          data.events.length > 0 && (
            <UpcomingEvents slug={slug} events={data.events} />
          )}
        {view === "student" && data.student && (
          <StudentHome
            slug={slug}
            data={data.student}
            runs={data.runs ?? null}
            training={data.training?.mine ?? null}
            events={data.events ?? null}
            openGroups={data.openGroups ?? false}
          />
        )}
        {view === "parent" && data.parent && (
          <ParentHome slug={slug} data={data.parent} />
        )}
        {view === "staff" && data.staff && (
          <StaffHome slug={slug} data={data.staff} />
        )}
      </div>
    </TermsContext.Provider>
  )
}

function HomeSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
