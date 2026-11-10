import assert from "node:assert/strict"
import { test } from "node:test"

import { parseRepo } from "./github.ts"

test("plain repository links, in their usual spellings", () => {
  for (const link of [
    "https://github.com/ada/calculator",
    "https://github.com/ada/calculator/",
    "https://github.com/ada/calculator.git",
    "github.com/ada/calculator",
    "http://www.github.com/ada/calculator",
    "git@github.com:ada/calculator.git",
    "  https://github.com/ada/calculator  ",
  ]) {
    assert.deepEqual(parseRepo(link), { owner: "ada", repo: "calculator", ref: null, commit: null, url: "https://github.com/ada/calculator" }, link)
  }
})

test("a branch or a commit from the link", () => {
  assert.equal(parseRepo("https://github.com/ada/calc/tree/feature/login")?.ref, "feature/login")
  assert.equal(parseRepo("https://github.com/ada/calc/commit/ABCDEF1")?.commit, "abcdef1")
})

test("anything else is refused", () => {
  for (const link of [
    "https://gitlab.com/ada/calc",
    "https://github.com.evil.example/ada/calc",
    "https://user:pass@github.com/ada/calc",
    "https://github.com:8080/ada/calc",
    "https://github.com/ada",
    "https://github.com/-ada/calc",
    "https://github.com/ada/calc/issues/1",
    "https://github.com/ada/calc/commit/xyz",
    "https://github.com/ada/calc/tree/../../x",
    "https://github.com/ada/..",
    "javascript:alert(1)",
    "",
  ]) {
    assert.equal(parseRepo(link), null, link)
  }
})
