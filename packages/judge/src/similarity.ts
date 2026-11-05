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
