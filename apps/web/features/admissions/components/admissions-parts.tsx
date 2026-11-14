"use client"

export type Status =
  | "submitted"
  | "reviewing"
  | "waitlisted"
  | "rejected"
  | "admitted"
  | "withdrawn"

export const STATUS: Record<
  Status,
  {
    label: string
    variant: "default" | "outline" | "secondary" | "destructive"
  }
> = {
  submitted: { label: "New", variant: "outline" },
  reviewing: { label: "Reviewing", variant: "secondary" },
  waitlisted: { label: "Waitlisted", variant: "secondary" },
  rejected: { label: "Not admitted", variant: "destructive" },
  admitted: { label: "Admitted", variant: "default" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
