"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"

import { useContentScope } from "@/features/account/scope"
import { ScopeNote } from "@/features/account/scope-switcher"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

interface MyOrgClasses {
  slug: string
  name: string
  classes: { id: string; name: string; path: string; level: string | null }[]
}

/** A student's classes in every organization, each opening its class page. */
export function MyClasses() {
  const { data, error } = useQuery({
    queryKey: ["me", "classes"],
    queryFn: () => api<MyOrgClasses[]>("/me/classes"),
  })
  const { shows } = useContentScope()
  if (!data) return <Loading error={error} />
  const orgs = data.filter((o) => shows(o.slug))

  return (
    <>
      <h1 className="mb-1 text-display-lg text-ink">My classes</h1>
      <p className="mb-5 text-body-sm text-body">
        The classes you&apos;re in. Each has its notices, work, grades and
        syllabus.
      </p>
      <ScopeNote hidden={data.length - orgs.length} />
      {data.length === 0 && (
        <div className="grid justify-items-start gap-2">
          <p className="text-body-sm text-body">
            You aren&apos;t in a class yet. Your college or company places you
            in one when you join.
          </p>
          <Link
            href="/orgs"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Your organizations
          </Link>
        </div>
      )}
      {orgs.map((org) => (
        <section
          key={org.slug}
          className="mb-6 grid gap-2"
          data-testid="my-org-classes"
        >
          <h2 className="text-title-md text-ink">
            <Link href={`/orgs/${org.slug}`} className="hover:underline">
              {org.name}
            </Link>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {org.classes.map((c) => (
              <Link
                key={c.id}
                href={`/orgs/${org.slug}/classes/${c.id}`}
                data-testid="my-class"
                className="grid gap-1 rounded-lg border border-hairline bg-card p-4 hover:border-hairline-strong"
              >
                <span className="flex items-center gap-2 text-title-sm text-ink">
                  {c.name}
                  {c.level && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-body">
                      {c.level}
                    </span>
                  )}
                </span>
                <span className="text-caption text-body">{c.path}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
