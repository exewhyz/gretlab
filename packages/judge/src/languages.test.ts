import assert from "node:assert/strict"
import { test } from "node:test"

import { isLanguageId, languageLabel } from "./languages.ts"

test("languageLabel names a known language", () => {
  assert.equal(languageLabel("python"), "Python 3.13")
})

test("languageLabel shows an unknown id as it was stored", () => {
  assert.equal(languageLabel("cobol"), "cobol")
})

test("isLanguageId refuses names an object inherits", () => {
  assert.equal(isLanguageId("toString"), false)
  assert.equal(isLanguageId("constructor"), false)
  assert.equal(languageLabel("toString"), "toString")
})
