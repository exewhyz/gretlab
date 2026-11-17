"use client"

import Link from "next/link"
import type { ComponentProps } from "react"

import { useViewer } from "@/features/account/use-viewer"

/** Where the logo leads: your home when signed in, the landing page otherwise. */
export const homeHref = (signedIn: boolean) => (signedIn ? "/home" : "/")

/**
 * The logo's link. Signed-in people go to their home (`/home`); visitors, and anyone still
 * owing the second sign-in step, go to the landing page (`/`).
 */
export function HomeLink(props: Omit<ComponentProps<typeof Link>, "href">) {
  const { data: viewer } = useViewer()
  return <Link {...props} href={homeHref(Boolean(viewer?.user))} />
}
