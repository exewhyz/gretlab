/** "Tue, 3 Nov 2026, 4:34 PM" in the viewer's own locale and timezone. */
export const formatDateTime = (value: string | Date) =>
  new Date(value).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

/** "3 Nov 2026". */
export const formatDate = (value: string | Date) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
