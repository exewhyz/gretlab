"use client"





export interface Band {
  min: number
  grade: string
  points?: number | null
}

export const shortDate = (day: string | null) =>
  day
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : ""

export const fmt = (n: number | null | undefined) =>
  n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1)

export const RESULT: Record<string, { label: string; tone: string }> = {
  pass: { label: "Pass", tone: "text-success" },
  fail: { label: "Needs to improve", tone: "text-destructive" },
  incomplete: { label: "Marks pending", tone: "text-muted-foreground" },
  none: { label: "–", tone: "text-muted-foreground" },
}

export interface ExamItem {
  id: string
  name: string
  startsOn: string | null
  endsOn: string | null
  weight: number
  termId?: string | null
  term?: string | null
  published: boolean
  papers: number
  marks: number
}

export interface Term {
  id: string
  name: string
  startsOn: string | null
  endsOn: string | null
}

export interface Paper {
  id: string
  subjectId: string
  subject: string
  maxMarks: number
  passMarks: number
  heldOn: string | null
  teacher: string | null
  entered: number
  canMark: boolean
}
