/**
 * Code similarity for plagiarism review, in the style of MOSS: normalize away what copying
 * usually changes (names, spacing, comments, literals), then compare fingerprints of the
 * token stream. Renaming variables or reformatting doesn't hide a copy; a different approach
 * does. It finds pairs worth a human look, and is never proof on its own.
 */

const KEYWORDS = new Set(
  (
    "and as assert async await break case catch class const continue def default del do elif else " +
    "enum except export extends false final finally for from function global if implements import in " +
    "instanceof interface is lambda let match new nonlocal not null or pass private protected public " +
    "raise return static struct super switch this throw throws true try typedef typeof union " +
    "unsigned using var void while with yield int long float double char bool boolean string str " +
    "list dict set tuple print input range len std cout cin endl include main"
  ).split(" ")
)

const TOKEN =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(==|!=|<=|>=|&&|\|\||\+\+|--|->|<<|>>|\*\*|\/\/|[^\s\w])/g

/** Comments dropped; identifiers, strings and numbers reduced to their kind. */
export function normalizeTokens(code: string): string[] {
  const tokens: string[] = []
  for (const match of code.matchAll(TOKEN)) {
    const [, comment, string, number, word, symbol] = match
    if (comment) continue
    if (string) tokens.push("S")
    else if (number) tokens.push("N")
    else if (word) tokens.push(KEYWORDS.has(word) ? word : "V")
    else if (symbol) tokens.push(symbol)
  }
  return tokens
}

function hash(text: string): number {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

const K = 5
const WINDOW = 4

/** Winnowing (Schleimer et al., 2003): the minimum hash of each window of k-grams. */
export function fingerprint(code: string): Set<number> {
  const tokens = normalizeTokens(code)
  if (tokens.length < K) return new Set([hash(tokens.join(" "))])
  const grams: number[] = []
  for (let i = 0; i + K <= tokens.length; i++) {
    grams.push(hash(tokens.slice(i, i + K).join(" ")))
  }
  const selected = new Set<number>()
  for (let i = 0; i + WINDOW <= grams.length; i++) {
    selected.add(Math.min(...grams.slice(i, i + WINDOW)))
  }
  if (grams.length < WINDOW) grams.forEach((gram) => selected.add(gram))
  return selected
}

/** Shared fingerprints over all fingerprints, from 0 to 1. */
export function similarity(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const value of a) if (b.has(value)) shared += 1
  return shared / (a.size + b.size - shared)
}

export interface SimilarityCandidate<T> {
  key: T
  code: string
}

export interface SimilarPair<T> {
  a: T
  b: T
  score: number
}

/** Every pair at or above the threshold, most similar first. */
export function findSimilarPairs<T>(
  candidates: SimilarityCandidate<T>[],
  threshold: number
): SimilarPair<T>[] {
  const prints = candidates.map((candidate) => ({
    key: candidate.key,
    print: fingerprint(candidate.code),
    // Very short programs look alike whoever wrote them; they'd only add noise.
    tokens: normalizeTokens(candidate.code).length,
  }))
  const pairs: SimilarPair<T>[] = []
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      const a = prints[i]
      const b = prints[j]
      if (!a || !b || Math.min(a.tokens, b.tokens) < 20) continue
      const score = similarity(a.print, b.print)
      if (score >= threshold) pairs.push({ a: a.key, b: b.key, score })
    }
  }
  return pairs.sort((x, y) => y.score - x.score)
}

/** Normalized tokens with the line each starts on (1-based), as `normalizeTokens` reads them. */
function tokensWithLines(code: string): { token: string; line: number }[] {
  const out: { token: string; line: number }[] = []
  let line = 1
  let at = 0
  for (const match of code.matchAll(TOKEN)) {
    for (; at < match.index; at++) if (code[at] === "\n") line++
    const [, comment, string, number, word, symbol] = match
    if (!comment) {
      const token = string
        ? "S"
        : number
          ? "N"
          : word
            ? KEYWORDS.has(word)
              ? word
              : "V"
            : symbol!
      out.push({ token, line })
    }
  }
  return out
}

export interface MatchingRegion {
  /** Numbered down the first program, so the same number marks the same stretch on both sides. */
  id: number
  a: { from: number; to: number }
  b: { from: number; to: number }
}

/** Shorter shared runs are common idioms (reading input, a print), not copying. */
const MIN_RUN = 20
/** Enough for any student program; past it the rest isn't compared. */
const MAX_TOKENS = 6000

/**
 * The stretches two programs share, as line ranges in each (greedy string tiling, as JPlag
 * does): repeatedly the longest run of normalized tokens found in both that isn't part of an
 * earlier match, down to MIN_RUN tokens. Renaming and comments don't break a run.
 */
export function matchingRegions(codeA: string, codeB: string): MatchingRegion[] {
  const a = tokensWithLines(codeA).slice(0, MAX_TOKENS)
  const b = tokensWithLines(codeB).slice(0, MAX_TOKENS)
  const usedA = new Uint8Array(a.length)
  const usedB = new Uint8Array(b.length)
  const tiles: { i: number; j: number; length: number }[] = []
  for (;;) {
    let best = { i: 0, j: 0, length: 0 }
    let prev = new Uint32Array(b.length + 1)
    for (let i = 1; i <= a.length; i++) {
      const row = new Uint32Array(b.length + 1)
      for (let j = 1; j <= b.length; j++) {
        if (
          !usedA[i - 1] &&
          !usedB[j - 1] &&
          a[i - 1]!.token === b[j - 1]!.token
        ) {
          row[j] = prev[j - 1]! + 1
          if (row[j]! > best.length)
            best = { i: i - row[j]!, j: j - row[j]!, length: row[j]! }
        }
      }
      prev = row
    }
    if (best.length < MIN_RUN) break
    usedA.fill(1, best.i, best.i + best.length)
    usedB.fill(1, best.j, best.j + best.length)
    tiles.push(best)
  }
  const regions = tiles
    .map((t) => ({
      a: { from: a[t.i]!.line, to: a[t.i + t.length - 1]!.line },
      b: { from: b[t.j]!.line, to: b[t.j + t.length - 1]!.line },
    }))
    .sort((x, y) => x.a.from - y.a.from)
  // Tiles that share a line on either side are shown as one stretch.
  const merged: Omit<MatchingRegion, "id">[] = []
  for (const r of regions) {
    const last = merged.at(-1)
    const overlaps =
      last &&
      ((r.a.from <= last.a.to && r.a.to >= last.a.from) ||
        (r.b.from <= last.b.to && r.b.to >= last.b.from))
    if (last && overlaps) {
      last.a = { from: Math.min(last.a.from, r.a.from), to: Math.max(last.a.to, r.a.to) }
      last.b = { from: Math.min(last.b.from, r.b.from), to: Math.max(last.b.to, r.b.to) }
    } else merged.push({ a: { ...r.a }, b: { ...r.b } })
  }
  return merged.map((r, index) => ({ id: index + 1, ...r }))
}
