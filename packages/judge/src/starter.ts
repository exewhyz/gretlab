/*
 * Starter code made from a reference solution: the part that reads the input stays,
 * functions keep their signatures with empty bodies, and the logic becomes a
 * "Your code here" comment. A teacher reviews the result; it's a first draft, not magic.
 */

import type { LanguageId } from "./languages.ts"

const TODO = "Your code here"

/** Lines grouped into top-level statements: a line at column 0 and everything indented under it. */
function topLevelBlocks(lines: string[]) {
  const blocks: string[][] = []
  for (const line of lines) {
    // `except`, `else` and the like continue the statement above them.
    const startsBlock =
      line.trim() !== "" &&
      !/^\s/.test(line) &&
      !/^[}\])]/.test(line) &&
      !/^(except|else|elif|finally)\b/.test(line)
    if (startsBlock || blocks.length === 0) blocks.push([line])
    else blocks[blocks.length - 1]!.push(line)
  }
  // Blank lines stay with the statement before them, so kept code keeps its spacing.
  return blocks
}

/** Kept statements back into source, spaced as the author wrote them. */
function assemble(parts: string[][], todo: string) {
  const body = parts
    .map((b) => b.join("\n"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*$/, "")
  return body ? `${body}\n\n${todo}\n` : `${todo}\n`
}

const has = (block: string[], pattern: RegExp) =>
  block.some((line) => pattern.test(line))

/* ---------- Python ---------- */

function pythonStarter(solution: string) {
  const blocks = topLevelBlocks(solution.replace(/\r/g, "").split("\n"))
  const reads = (b: string[]) => has(b, /\binput\s*\(|sys\.stdin/)
  const prints = (b: string[]) => has(b, /\bprint\s*\(|sys\.stdout/)
  const isImport = (b: string[]) => /^(import|from)\s/.test(b[0]!)
  const isDef = (b: string[]) => /^(def|class|async\s+def)\s/.test(b[0]!)
  const blank = (b: string[]) => b.join("").trim() === ""
  // Everything up to the last statement that reads input (without printing) is input handling.
  let last = -1
  blocks.forEach((b, i) => {
    if (reads(b) && !prints(b) && !isDef(b)) last = i
  })
  const out: string[][] = []
  blocks.forEach((b, i) => {
    if (blank(b)) return
    if (isImport(b)) out.push(b)
    else if (isDef(b)) {
      const end = b.findIndex((line) => /:\s*(#.*)?$/.test(line))
      out.push([...b.slice(0, end + 1), `    # ${TODO}`, "    pass", "", ""])
    } else if (i <= last) out.push(b)
  })
  return assemble(out, `# ${TODO}`)
}

/* ---------- JavaScript ---------- */

function javascriptStarter(solution: string) {
  const blocks = topLevelBlocks(solution.replace(/\r/g, "").split("\n"))
  // Names that hold input: what reads stdin, then values parsed out of those.
  const inputs = new Set<string>()
  const declaration = (b: string[]) =>
    b[0]!.match(/^(?:const|let|var)\s+(\[[^\]]*\]|\{[^}]*\}|\w+)\s*=\s*(.*)$/)
  const names = (pattern: string) =>
    pattern
      .replace(/[[\]{}]/g, "")
      .split(",")
      .map((n) => n.replace(/=.*$/, "").replace("...", "").trim())
      .filter(Boolean)
  // Parsing input: splitting it, converting it, picking a line. Mapping or sorting it is logic.
  const parses = /\.split\(|Number\(|BigInt\(|parseInt\(|parseFloat\(/
  const readsInput = (b: string[]) => {
    const decl = declaration(b)
    if (!decl) return false
    const [, pattern, value] = decl
    const text = [value, ...b.slice(1)].join("\n")
    if (/readFileSync|process\.stdin/.test(text)) return true
    const fromInput = [...inputs].some((n) =>
      new RegExp(`\\b${n}\\b`).test(text)
    )
    // `const [n, k] = data` unpacks input and `data.slice(2)` takes part of it; `let x = a`
    // only copies a value.
    const slicesInput = [...inputs].some((n) =>
      // A plain slice of input; sorting or filtering it afterwards is logic.
      new RegExp(`^\\s*${n}\\.slice\\([^()]*\\)\\s*$`).test(value!)
    )
    const picksLine = [...inputs].some((n) =>
      new RegExp(`\\b${n}\\[\\d+\\]`).test(text)
    )
    return (
      fromInput &&
      (parses.test(text) || slicesInput || picksLine || /^[[{]/.test(pattern!))
    )
  }
  const isFunction = (b: string[]) => /^(async\s+)?function\s/.test(b[0]!)
  const prints = (b: string[]) => has(b, /console\.log|process\.stdout/)
  let last = -1
  blocks.forEach((b, i) => {
    if (!isFunction(b) && readsInput(b) && !prints(b)) {
      names(declaration(b)![1]!).forEach((n) => inputs.add(n))
      last = i
    }
  })
  const out: string[][] = []
  blocks.forEach((b, i) => {
    if (b.join("").trim() === "") return
    if (isFunction(b)) {
      const end = b.findIndex((line) => /\{\s*$/.test(line))
      out.push([...b.slice(0, end + 1), `  // ${TODO}`, "}", "", ""])
    } else if (i <= last || /require\(/.test(b[0]!)) out.push(b)
  })
  return assemble(out, `// ${TODO}`)
}

/* ---------- C, C++ and Java ---------- */

/** Reading the program's input (not a file it wrote itself). */
const READS: Record<"c" | "cpp" | "java", RegExp> = {
  c: /\bscanf\s*\(|\bgetchar\s*\(|\b(fgets|getline|fread)\s*\([^;]*\bstdin\b/,
  cpp: /\bstd::cin\b|\bcin\s*>>|\bscanf\s*\(|\bfgets\s*\([^;]*\bstdin\b/,
  java: /\b(Scanner|BufferedReader|readLine|StringTokenizer|nextInt|nextLong|nextDouble|nextLine|nextBigInteger|next)\s*\(|\bnew Scanner\b|\bnew BufferedReader\b/,
}

/** The index of the line closing the brace opened on `start`. */
function closing(lines: string[], start: number) {
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!.replace(
      /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'|\/\/.*$/g,
      ""
    )) {
      if (ch === "{") depth++
      else if (ch === "}" && --depth === 0) return i
    }
  }
  return lines.length - 1
}

/** A body's statements at its own indentation, each with the lines indented under it. */
function statements(lines: string[]) {
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length)
  )
  const out: string[][] = []
  for (const line of lines) {
    const own =
      line.trim() !== "" &&
      line.match(/^\s*/)![0].length === indent &&
      !/^\s*[}\])]/.test(line)
    if (own || out.length === 0) out.push([line])
    else out[out.length - 1]!.push(line)
  }
  return out.filter((s) => s.join("").trim() !== "")
}

/** "return 0;" or similar, so a stubbed function still compiles. */
function defaultReturn(signature: string, language: "c" | "cpp" | "java") {
  const type = signature
    .replace(/\(.*$/, "")
    .replace(
      /\b(public|private|protected|static|final|inline|constexpr|virtual)\b/g,
      ""
    )
    .trim()
    .split(/\s+/)
    .slice(0, -1)
    .join(" ")
  if (!type || type === "void") return null
  if (language !== "java") return null // C and C++ compile without one; a warning at most
  if (/^(int|long|short|byte|double|float|char)$/.test(type)) return "return 0;"
  if (type === "boolean") return "return false;"
  return "return null;"
}

function braceStarter(solution: string, language: "c" | "cpp" | "java") {
  const lines = solution.replace(/\r/g, "").split("\n")
  const mainAt = lines.findIndex((l) =>
    language === "java"
      ? /\bstatic\s+void\s+main\s*\(/.test(l)
      : /\bint\s+main\s*\(/.test(l)
  )
  if (mainAt < 0) return solution
  const mainEnd = closing(lines, mainAt)
  // Printing output; fprintf to a file the program writes is not.
  const prints = /\b(printf|puts)\s*\(|\bcout\b|System\.out/
  // Helper functions that read input (and print nothing) stay whole, and calling one
  // counts as reading input.
  const signature =
    /^\s*[\w:<>,*&\s\[\]]+\s+\**(\w+)\s*\([^;]*\)\s*(const\s*)?(throws [\w, .]+)?\s*\{\s*$/
  const readers = new Set<string>()
  lines.forEach((line, at) => {
    const name = line.match(signature)?.[1]
    if (
      !name ||
      at === mainAt ||
      /^\s*(if|for|while|switch|else|do|catch|try)\b/.test(line)
    )
      return
    const body = lines.slice(at, closing(lines, at) + 1)
    if (has(body, READS[language]) && !has(body, prints)) readers.add(name)
  })
  const reads = (s: string[]) =>
    has(s, READS[language]) ||
    [...readers].some((name) => has(s, new RegExp(`\\b${name}\\s*\\(`)))
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (i === mainAt) {
      const indent = line.match(/^\s*/)![0] + "    "
      const body = statements(lines.slice(i + 1, mainEnd))
      let last = -1
      body.forEach((s, n) => {
        if (reads(s) && !has(s, prints)) last = n
      })
      out.push(line)
      body.slice(0, last + 1).forEach((s) => out.push(...s))
      if (last >= 0) out.push("")
      out.push(`${indent}// ${TODO}`)
      const ret = body.at(-1)?.join("\n").trim()
      if (ret && /^return\b/.test(ret)) out.push("", ...body.at(-1)!)
      out.push(lines[mainEnd]!)
      i = mainEnd + 1
      continue
    }
    // A function written on one line: the same, spread out.
    const oneLine = line.match(
      /^(\s*[\w:<>,*&\s\[\]]+\s+\**\w+\s*\([^;{]*\)\s*(?:const\s*)?)\{.*\}\s*$/
    )
    if (
      oneLine &&
      !/^\s*(if|for|while|switch|else|do|return)\b/.test(line) &&
      !/\b(class|struct|enum|interface|record|union)\b/.test(line)
    ) {
      const indent = line.match(/^\s*/)![0]
      const ret = defaultReturn(oneLine[1]!.trim(), language)
      out.push(`${oneLine[1]!.trimEnd()} {`, `${indent}    // ${TODO}`)
      if (ret) out.push(`${indent}    ${ret}`)
      out.push(`${indent}}`)
      i++
      continue
    }
    // Another function: keep its signature, empty its body.
    const isFunction =
      /^\s*[\w:<>,*&\s\[\]]+\s+\**\w+\s*\([^;]*\)\s*(const\s*)?(throws [\w, .]+)?\s*\{\s*$/.test(
        line
      ) &&
      !/^\s*(if|for|while|switch|else|do|catch|try)\b/.test(line) &&
      !/\b(class|struct|enum|interface|record|union)\b/.test(line)
    const reader = line.match(signature)?.[1]
    if (isFunction && reader && readers.has(reader)) {
      const end = closing(lines, i)
      out.push(...lines.slice(i, end + 1))
      i = end + 1
      continue
    }
    if (isFunction) {
      const end = closing(lines, i)
      const indent = line.match(/^\s*/)![0] + "    "
      out.push(line, `${indent}// ${TODO}`)
      const ret = defaultReturn(line.trim(), language)
      if (ret) out.push(`${indent}${ret}`)
      out.push(lines[end]!)
      i = end + 1
      continue
    }
    out.push(line)
    i++
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*$/, "\n")
}

/** A first draft of starter code from a reference solution. */
export function starterFromSolution(
  language: LanguageId,
  solution: string
): string {
  if (!solution.trim()) return ""
  switch (language) {
    case "python":
      return pythonStarter(solution)
    case "javascript":
      return javascriptStarter(solution)
    case "c":
    case "cpp":
    case "java":
      return braceStarter(solution, language)
  }
}
