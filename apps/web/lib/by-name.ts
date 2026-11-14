/**
 * Orders names as people read them: numbers by value ("Grade 6" before "Grade 10",
 * "Lab 2" before "Lab 11"), letters ignoring case and accents. Use it for every list
 * sorted by a name or title (groups, classes, people, books, routes).
 */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})

export const byName = (a: string, b: string) => collator.compare(a, b)
