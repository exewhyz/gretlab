/** Ignores trailing spaces on each line and trailing blank lines. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected)
}

export function describeFirstDifference(
  actual: string,
  expected: string
): string {
  const expectedLines = normalizeOutput(expected).split("\n")
  const actualLines = normalizeOutput(actual).split("\n")
  let line = 0
  while (
    line < Math.max(expectedLines.length, actualLines.length) &&
    expectedLines[line] === actualLines[line]
  ) {
    line += 1
  }
  const show = (value: string | undefined) =>
    JSON.stringify(value === undefined ? "(nothing)" : value)
  return `First difference on line ${line + 1}: expected ${show(expectedLines[line])}, got ${show(actualLines[line])}`
}
