"use client"

import { useEffect } from "react"

import { carryOverSlugs } from "../lib/moved-slugs"

/** Moves this browser's saved progress from problems' old addresses to their new ones. */
export function CarryOverProgress({ moved }: { moved: Record<string, string> }) {
  useEffect(() => carryOverSlugs(moved), [moved])
  return null
}
