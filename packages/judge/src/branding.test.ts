import assert from "node:assert/strict"
import { test } from "node:test"

import {
  accentProblem,
  accentVars,
  brandingSchema,
  contrast,
  onAccent,
} from "./branding.ts"

test("contrast follows WCAG: black on white is 21, a colour on itself is 1", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21)
  assert.equal(contrast("#3366cc", "#3366cc"), 1)
  assert.equal(contrast("#ffffff", "#000000"), contrast("#000000", "#ffffff"))
})

test("a brand colour must stand out on both the light and the dark page", () => {
  // GretLab's own orange and a college blue: fine on both.
  assert.equal(accentProblem("#f54e00"), null)
  assert.equal(accentProblem("#2f6fde"), null)
  // Too pale for the light page, too dark for the dark one.
  assert.match(accentProblem("#ffe08a") ?? "", /light/)
  assert.match(accentProblem("#0b1f4d") ?? "", /dark/)
})

test("only six-digit hex colours", () => {
  assert.ok(accentProblem("blue"))
  assert.ok(accentProblem("#fff"))
  assert.equal(brandingSchema.shape.accent.safeParse("#2F6FDE").success, true)
  assert.equal(brandingSchema.shape.accent.safeParse("red").success, false)
  assert.equal(brandingSchema.shape.accent.safeParse(null).success, true)
})

test("text on the colour is white or ink, whichever reads better", () => {
  assert.equal(onAccent("#2f6fde"), "#ffffff")
  assert.equal(onAccent("#7fd1ae"), "#26251e")
})

test("the page's variables: the colour, its text, and a darker pressed shade", () => {
  const vars = accentVars("#2f6fde")
  assert.equal(vars["--primary"], "#2f6fde")
  assert.equal(vars["--sidebar-primary"], "#2f6fde")
  assert.equal(vars["--primary-foreground"], "#ffffff")
  assert.equal(vars["--sidebar-primary-foreground"], "#ffffff")
  assert.ok(
    contrast(vars["--primary-active"]!, "#ffffff") >
      contrast("#2f6fde", "#ffffff")
  )
})
