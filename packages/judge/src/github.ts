/*
 * GitHub repository links for project submissions. Strict on purpose: only github.com,
 * names GitHub allows, and a branch or commit when the link has one. The server only ever
 * calls api.github.com with these checked parts, so a link can't point it anywhere else.
 */

export interface RepoRef {
  owner: string
  repo: string
  /** A branch or tag from a /tree/ link. */
  ref: string | null
  /** A full or short commit from a /commit/ link. */
  commit: string | null
  /** The canonical address: https://github.com/owner/repo */
  url: string
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._\/-]{1,200}$/
const SHA = /^[0-9a-f]{7,40}$/i

export function parseRepo(input: string): RepoRef | null {
  let text = input.trim()
  const ssh = /^git@github\.com:(.+)$/.exec(text)
  if (ssh) text = `https://github.com/${ssh[1]}`
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  // URL parsing resolves "..", which would turn one path into another: refuse them outright.
  if (/(^|\/)\.\.?(\/|$)/.test(text.replace(/^https?:\/\//i, "")) || /%2e/i.test(text)) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) return null
  if (url.username || url.password || (url.port && url.port !== "443")) return null
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  if (parts.length < 2) return null
  const owner = parts[0]!
  const repo = parts[1]!.replace(/\.git$/, "")
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null
  let ref: string | null = null
  let commit: string | null = null
  const rest = parts.slice(2)
  if (rest[0] === "tree" && rest.length > 1) {
    ref = rest.slice(1).join("/")
    if (!REF.test(ref) || ref.includes("..")) return null
  } else if (rest[0] === "commit" && rest.length === 2) {
    commit = rest[1]!.toLowerCase()
    if (!SHA.test(commit)) return null
  } else if (rest.length > 0) {
    return null
  }
  return { owner, repo, ref, commit, url: `https://github.com/${owner}/${repo}` }
}

export const isCommitSha = (s: string) => SHA.test(s)
