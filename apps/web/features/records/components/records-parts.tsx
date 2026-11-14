"use client"

export interface Year {
  id: string
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
  enrolled: number
}

export const longDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

export interface Row {
  id: string
  name: string
  admissionNo: string
  gender: string
  login: boolean
  group: { id: string; path: string } | null
  rollNo: number | null
  status: string | null
}

export const GENDER: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  "": "—",
}
