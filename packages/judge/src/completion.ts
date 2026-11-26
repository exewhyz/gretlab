/**
 * Code completion for C, C++ and Java, in the browser (the owner's decision, 26 November 2026:
 * no language servers). It reads the student's files the way a reader skims them, not the way a
 * compiler does: the names they declared (variables with their types, functions, structs and
 * classes with their members, typedefs), and the standard library's parts in
 * ./completion-catalog.ts. After a dot, `->` or `::` it offers the members of what's before it,
 * from its declared type (an element of a vector or an array has the element's). Comments and
 * strings are ignored. Wrong guesses only cost a suggestion; nothing here judges code.
 */
import {
  C_GLOBALS,
  C_HEADERS,
  C_KEYWORDS,
  C_SNIPPETS,
  CPP_HEADERS,
  CPP_KEYWORDS,
  CPP_SNIPPETS,
  CPP_STD,
  CPP_TYPES,
  JAVA_KEYWORDS,
  JAVA_PACKAGES,
  JAVA_SNIPPETS,
  JAVA_STATICS,
  JAVA_TYPES,
} from "./completion-catalog.ts"

export type CompletionLanguage = "c" | "cpp" | "java"

export type CompletionKind =
  | "keyword"
  | "snippet"
  | "function"
  | "method"
  | "field"
  | "variable"
  | "class"
  | "module"
  | "constant"

export interface Completion {
  label: string
  kind: CompletionKind
  /** What's inserted; a snippet when `snippet` ($0 is where the cursor ends). */
  insert: string
  snippet: boolean
  /** Where it comes from: a type's name, "your code". */
  detail?: string
}

interface File {
  path: string
  content: string
}

/* ---------- reading code ---------- */

/** The source with comments and string and character literals blanked, offsets kept. */
export function blankCode(src: string): string {
  const out = src.split("")
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++)
      if (out[k] !== "\n") out[k] = " "
  }
  while (i < src.length) {
    const c = src[i]!
    const next = src[i + 1]
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i)
      const stop = end < 0 ? src.length : end
      blank(i, stop)
      i = stop
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2)
      const stop = end < 0 ? src.length : end + 2
      blank(i, stop)
      i = stop
    } else if (c === '"' || c === "'") {
      let k = i + 1
      while (k < src.length && src[k] !== c && src[k] !== "\n")
        k += src[k] === "\\" ? 2 : 1
      blank(i + 1, k)
      i = k + 1
    } else i++
  }
  return out.join("")
}

/** Everything inside braces removed (each block becomes ";"), leaving the outermost level. */
function outerLevel(code: string): string {
  let depth = 0
  let out = ""
  for (const c of code) {
    if (c === "{") {
      if (depth === 0) out += ";"
      depth++
    } else if (c === "}") depth = Math.max(0, depth - 1)
    else if (depth === 0) out += c
  }
  return out
}

/** Splits at commas outside brackets of any kind. */
function splitTop(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if ("<([{".includes(c)) depth++
    else if (">)]}".includes(c)) depth = Math.max(0, depth - 1)
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** A written type, as a name and its template or generic arguments. */
interface TypeRef {
  name: string
  args: string[]
  /** Array levels: `int a[5]` and `int[] a` are 1. */
  dims: number
}

const QUALIFIERS =
  /^(?:(?:const|static|final|volatile|mutable|unsigned|signed|struct|class|typename|inline|constexpr|public|private|protected)\s+)+/

function parseType(text: string, dims = 0): TypeRef {
  let t = text
    .trim()
    .replace(QUALIFIERS, "")
    .replace(/[\s*&]+$/, "")
  while (t.endsWith("[]")) {
    dims++
    t = t.slice(0, -2).trim()
  }
  const lt = t.indexOf("<")
  const head = (lt < 0 ? t : t.slice(0, lt)).trim()
  const args =
    lt < 0
      ? []
      : splitTop(t.slice(lt + 1, t.lastIndexOf(">"))).map((a) => a.trim())
  const segments = head.split(/::|\./).filter(Boolean)
  return { name: segments[segments.length - 1] ?? head, args, dims }
}

interface Declaration {
  name: string
  type: string
  dims: number
  offset: number
  path: string
}

interface Member {
  name: string
  kind: "field" | "method"
  type: string
  dims: number
}

interface Symbols {
  variables: Declaration[]
  functions: Set<string>
  classes: Map<string, Member[]>
  aliases: Map<string, string>
  usingStd: boolean
}

const CPP_TYPE = String.raw`(?:(?:const|static|unsigned|signed)\s+)*(?:long\s+long|long\s+double|[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)(?:\s*<(?:[^<>;{}()]|<(?:[^<>;{}()]|<[^<>;{}()]*>)*>)*>)?`
const JAVA_TYPE = String.raw`(?:final\s+)?[A-Za-z_][\w.]*(?:\s*<(?:[^<>;{}()]|<(?:[^<>;{}()]|<[^<>;{}()]*>)*>)*>)?(?:\s*\[\s*\])*`

const C_BUILTINS = new Set([
  "int",
  "long",
  "short",
  "char",
  "double",
  "float",
  "bool",
  "void",
  "auto",
  "size_t",
  "unsigned",
  "signed",
  "string",
  "FILE",
])
const JAVA_BUILTINS = new Set([
  "int",
  "long",
  "short",
  "char",
  "double",
  "float",
  "boolean",
  "byte",
  "var",
  "String",
  "Object",
])
const NOT_TYPES = new Set([
  "return",
  "else",
  "case",
  "delete",
  "new",
  "throw",
  "goto",
  "using",
  "typedef",
  "namespace",
  "sizeof",
  "if",
  "while",
  "for",
  "switch",
  "do",
  "package",
  "import",
  "extends",
  "implements",
  "instanceof",
  "throws",
])

/** Members of a struct or class body: fields and methods (constructors left out). */
function membersOf(body: string, className: string, java: boolean): Member[] {
  const members: Member[] = []
  const flat = outerLevel(body).replace(
    /\b(?:public|private|protected)\s*:/g,
    ";"
  )
  for (const raw of flat.split(";")) {
    const statement = raw.replace(/@\w+/g, "").trim()
    if (!statement) continue
    const call = statement.match(/([A-Za-z_~]\w*)\s*\(/)
    if (call) {
      const name = call[1]!
      const before = statement.slice(0, call.index).trim()
      if (
        name !== className &&
        !name.startsWith("~") &&
        before &&
        !NOT_TYPES.has(name)
      )
        members.push({ name, kind: "method", type: before, dims: 0 })
      continue
    }
    const [first, ...rest] = splitTop(statement)
    const head = first!.split("=")[0]!.trim()
    const m = head.match(/^(.*?)([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*)$/)
    if (!m || !m[1]!.trim()) continue
    const type = m[1]!.trim()
    const dims = (m[3]!.match(/\[/g) ?? []).length
    members.push({ name: m[2]!, kind: "field", type, dims })
    for (const more of rest) {
      const n = more
        .split("=")[0]!
        .trim()
        .match(/^[*&\s]*([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*)/)
      if (n)
        members.push({
          name: n[1]!,
          kind: "field",
          type,
          dims: (n[2]!.match(/\[/g) ?? []).length,
        })
    }
  }
  void java
  return members
}

function scan(language: CompletionLanguage, files: File[]): Symbols {
  const java = language === "java"
  const symbols: Symbols = {
    variables: [],
    functions: new Set(),
    classes: new Map(),
    aliases: new Map(),
    usingStd: false,
  }
  const codes = files.map((f) => ({
    path: f.path,
    code: blankCode(f.content),
    raw: f.content,
  }))
  // Structs and classes first, so declarations of their type are recognised.
  for (const { code } of codes) {
    const re = java
      ? /\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)[^{;]*\{/g
      : /\b(?:struct|class)\s+([A-Za-z_]\w*)[^{;()]*\{/g
    for (const m of code.matchAll(re)) {
      const open = m.index! + m[0].length - 1
      let depth = 0
      let end = open
      for (; end < code.length; end++) {
        if (code[end] === "{") depth++
        else if (code[end] === "}" && --depth === 0) break
      }
      symbols.classes.set(
        m[1]!,
        membersOf(code.slice(open + 1, end), m[1]!, java)
      )
      if (java)
        for (const member of symbols.classes.get(m[1]!)!)
          if (member.kind === "method") symbols.functions.add(member.name)
    }
    if (!java) {
      for (const m of code.matchAll(/\b(?:struct|class)\s+([A-Za-z_]\w*)\s*;/g))
        if (!symbols.classes.has(m[1]!)) symbols.classes.set(m[1]!, [])
    }
  }
  if (!java) {
    for (const { code, raw } of codes) {
      if (/\busing\s+namespace\s+std\s*;/.test(code)) symbols.usingStd = true
      for (const m of code.matchAll(
        /\btypedef\s+([^;]+?)\s+([A-Za-z_]\w*)\s*;/g
      ))
        symbols.aliases.set(m[2]!, m[1]!)
      for (const m of code.matchAll(/\busing\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g))
        symbols.aliases.set(m[1]!, m[2]!)
      for (const m of raw.matchAll(
        /^[ \t]*#\s*define\s+([A-Za-z_]\w*)[ \t]+([^\n(]+)$/gm
      ))
        symbols.aliases.set(m[1]!, m[2]!.trim())
      // Functions declared or defined at the outermost level (bodies removed).
      for (const m of outerLevel(code).matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
        const name = m[1]!
        if (!CPP_KEYWORDS.includes(name) && !symbols.aliases.has(name))
          symbols.functions.add(name)
      }
    }
  }
  const knownType = (type: string) => {
    const { name } = parseType(type)
    if (java)
      return (
        JAVA_BUILTINS.has(name) ||
        name in JAVA_TYPES ||
        name in JAVA_STATICS ||
        symbols.classes.has(name)
      )
    return (
      C_BUILTINS.has(name) ||
      /^(?:long|unsigned|signed)\b/.test(type.trim()) ||
      /_t$/.test(name) ||
      name in CPP_TYPES ||
      symbols.classes.has(name) ||
      symbols.aliases.has(name)
    )
  }
  const decl = new RegExp(
    java
      ? String.raw`(${JAVA_TYPE})\s+([A-Za-z_]\w*)\s*(?=[;=,):])`
      : String.raw`(${CPP_TYPE})[\s*&]+([A-Za-z_]\w*)\s*(?=[;=,\[({):])`,
    "g"
  )
  const keywords = java ? JAVA_KEYWORDS : CPP_KEYWORDS
  for (const { path, code } of codes) {
    for (const m of code.matchAll(decl)) {
      const type = m[1]!.trim()
      const name = m[2]!
      const firstWord = type.split(/[\s<:.]/)[0]!
      if (
        NOT_TYPES.has(firstWord) ||
        keywords.includes(name) ||
        !knownType(type)
      )
        continue
      const before = code.slice(0, m.index).trimEnd()
      if (/\btypedef$/.test(before)) continue
      const after = code.slice(m.index! + m[0].length)
      const dims = java
        ? 0
        : (
            (after.match(/^\s*((?:\[[^\]]*\]\s*)*)/)?.[1] ?? "").match(/\[/g) ??
            []
          ).length
      symbols.variables.push({ name, type, dims, offset: m.index!, path })
      // `int a, b = 2, c;`: the rest of the statement, unless this is a parameter list.
      if (/[(,]$/.test(before)) continue
      const end = after.search(/[;)]/)
      const statement = after.slice(0, end < 0 ? after.length : end)
      const parts = splitTop(statement).slice(1)
      for (const part of parts) {
        const n = part
          .split("=")[0]!
          .trim()
          .match(/^[*&\s]*([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*)$/)
        if (n && !keywords.includes(n[1]!))
          symbols.variables.push({
            name: n[1]!,
            type,
            dims: (n[2]!.match(/\[/g) ?? []).length,
            offset: m.index!,
            path,
          })
      }
    }
    // `var x = new ArrayList<>()`: the type it's made from.
    if (java)
      for (const v of symbols.variables)
        if (v.path === path && parseType(v.type).name === "var") {
          const made = code
            .slice(v.offset)
            .match(/^[^;]*?=\s*new\s+([A-Za-z_][\w.]*(?:<[^;(]*>)?)\s*(\[)?/)
          if (made) v.type = made[2] ? `${made[1]}[]` : made[1]!
        }
  }
  return symbols
}

/* ---------- what to offer ---------- */

function fromCatalog(
  entry: string,
  kind: "member" | "global",
  detail?: string
): Completion {
  if (entry.endsWith("()"))
    return {
      label: entry.slice(0, -2),
      kind: kind === "member" ? "method" : "function",
      insert: entry,
      snippet: false,
      detail,
    }
  if (entry.endsWith("("))
    return {
      label: entry.slice(0, -1),
      kind: kind === "member" ? "method" : "function",
      insert: `${entry}$0)`,
      snippet: true,
      detail,
    }
  return {
    label: entry,
    kind:
      /^[A-Z0-9_]+$/.test(entry) && entry.length > 1
        ? "constant"
        : kind === "member"
          ? "field"
          : "variable",
    insert: entry,
    snippet: false,
    detail,
  }
}

function fromMember(m: Member, owner: string): Completion {
  return m.kind === "method"
    ? {
        label: m.name,
        kind: "method",
        insert: `${m.name}($0)`,
        snippet: true,
        detail: owner,
      }
    : {
        label: m.name,
        kind: "field",
        insert: m.name,
        snippet: false,
        detail: owner,
      }
}

function unique(items: Completion[]): Completion[] {
  const seen = new Set<string>()
  return items.filter((i) => !seen.has(i.label) && seen.add(i.label))
}

/** The type a written type comes to, through typedefs, using and #define. */
function resolve(type: string, symbols: Symbols, dims = 0): TypeRef {
  let ref = parseType(type, dims)
  for (let hops = 0; hops < 5 && symbols.aliases.has(ref.name); hops++)
    ref = parseType(symbols.aliases.get(ref.name)!, ref.dims)
  return ref
}

/** What indexing gives: an array's element, a vector's, a map's value. */
function indexed(ref: TypeRef, symbols: Symbols): TypeRef | null {
  if (ref.dims > 0) return { ...ref, dims: ref.dims - 1 }
  if (
    ["vector", "deque", "array", "List", "ArrayList"].includes(ref.name) &&
    ref.args[0]
  )
    return resolve(ref.args[0], symbols)
  if (["map", "unordered_map"].includes(ref.name) && ref.args[1])
    return resolve(ref.args[1], symbols)
  return null
}

function membersOfType(
  ref: TypeRef,
  java: boolean,
  symbols: Symbols
): Completion[] {
  if (ref.dims > 0)
    return java
      ? [
          {
            label: "length",
            kind: "field",
            insert: "length",
            snippet: false,
            detail: "array",
          },
        ]
      : []
  const own = symbols.classes.get(ref.name)
  if (own) return unique(own.map((m) => fromMember(m, ref.name)))
  const catalog = java ? JAVA_TYPES[ref.name] : CPP_TYPES[ref.name]
  return catalog
    ? unique(catalog.map((e) => fromCatalog(e, "member", ref.name)))
    : []
}

/** The declaration of a name nearest before the cursor in its file, else anywhere. */
function declarationOf(
  name: string,
  symbols: Symbols,
  path: string,
  offset: number
) {
  const all = symbols.variables.filter((v) => v.name === name)
  const here = all.filter((v) => v.path === path && v.offset <= offset)
  return (
    here[here.length - 1] ?? all.find((v) => v.path !== path) ?? all[0] ?? null
  )
}

/** After `receiver.`, `receiver->` or `receiver::`. */
function memberCompletions(
  language: CompletionLanguage,
  receiver: string,
  op: string,
  symbols: Symbols,
  path: string,
  offset: number
): Completion[] {
  const java = language === "java"
  const compact = receiver.replace(/\s+/g, "")
  if (!java && op === "::") {
    if (compact === "std")
      return unique([
        ...Object.keys(CPP_TYPES).map((t): Completion => ({
          label: t,
          kind: "class",
          insert: t,
          snippet: false,
          detail: "std",
        })),
        ...CPP_STD.map((e) => fromCatalog(e, "global", "std")),
      ])
    const own = symbols.classes.get(compact)
    return own ? unique(own.map((m) => fromMember(m, compact))) : []
  }
  if (java && compact in JAVA_STATICS) {
    const isVariable = symbols.variables.some((v) => v.name === compact)
    if (!isVariable)
      return unique(
        JAVA_STATICS[compact]!.map((e) => fromCatalog(e, "member", compact))
      )
  }
  // a.b[2].c: each step from the one before.
  const steps = compact.split(/\.|->/)
  let ref: TypeRef | null = null
  for (const [i, step] of steps.entries()) {
    const m = step.match(/^([A-Za-z_]\w*)((?:\[[^\]]*\])*)$/)
    if (!m) return []
    const name = m[1]!
    const indexes = (m[2]!.match(/\[/g) ?? []).length
    if (i === 0) {
      const d = declarationOf(name, symbols, path, offset)
      if (!d) {
        // A class used statically: its own members.
        const own = symbols.classes.get(name)
        if (own && steps.length === 1 && !indexes)
          return unique(own.map((x) => fromMember(x, name)))
        return []
      }
      ref = resolve(d.type, symbols, d.dims)
    } else {
      const own: Member[] | undefined = symbols.classes.get(ref!.name)
      const field = own?.find((f) => f.name === name && f.kind === "field")
      if (!field) return []
      ref = resolve(field.type, symbols, field.dims)
    }
    for (let k = 0; k < indexes && ref; k++) ref = indexed(ref, symbols)
    if (!ref) return []
  }
  return ref ? membersOfType(ref, java, symbols) : []
}

/** What fits where the cursor is in `path`, at `offset` (a character offset into its content). */
export function completeAt(input: {
  language: CompletionLanguage
  files: File[]
  path: string
  offset: number
}): Completion[] {
  const { language, files, path } = input
  const java = language === "java"
  const file = files.find((f) => f.path === path)
  if (!file) return []
  const offset = Math.max(0, Math.min(input.offset, file.content.length))
  const raw = file.content.slice(0, offset)
  const line = raw.slice(raw.lastIndexOf("\n") + 1)

  if (!java) {
    if (/^\s*#\s*include\s*<[^>]*$/.test(line))
      return (
        language === "c"
          ? C_HEADERS
          : [
              ...CPP_HEADERS,
              ...C_HEADERS.map((h) => `c${h.replace(/\.h$/, "")}`),
            ]
      )
        .filter((h, i, all) => all.indexOf(h) === i)
        .map((h) => ({ label: h, kind: "module", insert: h, snippet: false }))
  } else {
    const imp = line.match(/^\s*import\s+(?:static\s+)?([\w.]*)$/)
    if (imp) {
      const typed = imp[1]!
      const pkg = typed.slice(0, typed.lastIndexOf("."))
      if (JAVA_PACKAGES[pkg])
        return JAVA_PACKAGES[pkg].map((c) => ({
          label: c,
          kind: c === "*" ? "module" : "class",
          insert: c,
          snippet: false,
          detail: pkg,
        }))
      const prefix = pkg ? `${pkg}.` : ""
      const next = Object.keys(JAVA_PACKAGES)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length).split(".")[0]!)
      return [...new Set(next)].map((s) => ({
        label: s,
        kind: "module",
        insert: s,
        snippet: false,
      }))
    }
  }

  const symbols = scan(language, files)
  const code = blankCode(raw)
  const member = code.match(
    /((?:[A-Za-z_]\w*(?:\s*\[[^[\]]*\])*)(?:\s*(?:\.|->)\s*[A-Za-z_]\w*(?:\s*\[[^[\]]*\])*)*)\s*(\.|->|::)\s*\w*$/
  )
  if (member && !(java && /^\d/.test(member[1]!)))
    return memberCompletions(
      language,
      member[1]!,
      member[2]!,
      symbols,
      path,
      offset
    )
  // A dot after something that isn't a name (a call, a literal): nothing to offer.
  if (/(?:\.|->|::)\s*\w*$/.test(code)) return []

  const own: Completion[] = [
    ...[...symbols.variables]
      .reverse()
      .map((v): Completion => ({
        label: v.name,
        kind: "variable",
        insert: v.name,
        snippet: false,
        detail: v.type,
      })),
    ...[...symbols.functions].map((f): Completion => ({
      label: f,
      kind: "function",
      insert: `${f}($0)`,
      snippet: true,
      detail: "your code",
    })),
    ...[...symbols.classes.keys()].map((c): Completion => ({
      label: c,
      kind: "class",
      insert: c,
      snippet: false,
      detail: "your code",
    })),
  ]
  const snippets = Object.entries(
    java ? JAVA_SNIPPETS : language === "c" ? C_SNIPPETS : CPP_SNIPPETS
  ).map(([label, insert]): Completion => ({
    label,
    kind: "snippet",
    insert,
    snippet: true,
    detail: "snippet",
  }))
  const library: Completion[] = java
    ? [...new Set([...Object.keys(JAVA_TYPES), ...Object.keys(JAVA_STATICS)])]
        .filter((c) => !c.includes("."))
        .map((c) => ({ label: c, kind: "class", insert: c, snippet: false }))
    : [
        ...C_GLOBALS.map((e) => fromCatalog(e, "global")),
        ...(language === "cpp" && symbols.usingStd
          ? [
              ...Object.keys(CPP_TYPES).map((t): Completion => ({
                label: t,
                kind: "class",
                insert: t,
                snippet: false,
                detail: "std",
              })),
              ...CPP_STD.map((e) => fromCatalog(e, "global", "std")),
            ]
          : []),
      ]
  const keywords = (
    java ? JAVA_KEYWORDS : language === "c" ? C_KEYWORDS : CPP_KEYWORDS
  ).map((k): Completion => ({
    label: k,
    kind: "keyword",
    insert: k,
    snippet: false,
  }))
  return unique([...own, ...snippets, ...library, ...keywords])
}
