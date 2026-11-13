import assert from "node:assert/strict"
import { test } from "node:test"

import { EMAIL_TEMPLATES, EMAIL_TEMPLATE_KEYS, exampleValues, renderEmail, templateProblem, DEFAULT_FOOTER } from "./emails.ts"

const layout = { site: "Gretlab", siteUrl: "https://g.example", footer: DEFAULT_FOOTER }

test("every default template is valid and renders", () => {
  for (const key of EMAIL_TEMPLATE_KEYS) {
    const t = EMAIL_TEMPLATES[key]
    assert.equal(templateProblem(key, t.subject, t.body), null, key)
    const r = renderEmail(t, exampleValues(key), layout)
    assert.ok(r.subject && r.text && r.html.startsWith("<!doctype html>"), key)
    assert.ok(!r.html.includes("{{") && !r.text.includes("{{"), key)
  }
  assert.equal(templateProblem("layout", "", DEFAULT_FOOTER), null)
})

test("unknown and missing placeholders are refused", () => {
  assert.match(templateProblem("account.reset", "Reset", "Hi {{nmae}} {{link}}")!, /Unknown placeholder: \{\{nmae\}\}/)
  assert.match(templateProblem("auth.code", "Code", "Your code")!, /Keep \{\{code\}\}/)
  assert.equal(templateProblem("auth.code", "Code {{code}}", "Here: {{code}}"), null)
})

test("text and html", () => {
  const r = renderEmail(
    { subject: "Hi {{name}}", body: "Hello **{{name}}**.\n\n[button: Go]({{link}})\n\n- one\n- two\n\nSee [the site]({{siteUrl}})." },
    { name: "Priya", link: "https://g.example/x?a=1&b=2" },
    layout
  )
  assert.equal(r.subject, "Hi Priya")
  assert.ok(r.text.startsWith("Hello Priya.\n\nGo: https://g.example/x?a=1&b=2\n\n- one\n- two\n\nSee the site (https://g.example)."), r.text)
  assert.ok(r.text.endsWith("Sent by Gretlab · https://g.example"))
  assert.ok(r.html.includes("<strong>Priya</strong>"))
  assert.ok(r.html.includes('href="https://g.example/x?a=1&amp;b=2"'))
  assert.ok(r.html.includes("<li"))
})

test("values are never markup, and are escaped", () => {
  const r = renderEmail(
    { subject: "{{title}}", body: "{{body}}\n\n[button: Open]({{link}})" },
    { title: "x", body: "<script>alert(1)</script> **not bold** [x](https://evil.example)", link: "javascript:alert(1)" },
    layout
  )
  assert.ok(!r.html.includes("<script>"))
  assert.ok(r.html.includes("&lt;script&gt;"))
  assert.ok(r.html.includes("**not bold**"))
  assert.ok(!r.html.includes('href="https://evil.example"'))
  // A link that isn't http(s) or mailto is dropped: no button.
  assert.ok(!r.html.includes("javascript:"))
})

test("a list placeholder renders as a list", () => {
  const r = renderEmail(EMAIL_TEMPLATES["digest.weekly"], { org: "Demo", lines: "- 4 new\n- 2 due", reportsLink: "https://g.example/r" }, layout)
  assert.ok(r.html.includes("<li style=\"margin:4px 0\">4 new</li>"))
})
