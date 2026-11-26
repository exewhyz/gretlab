import assert from "node:assert/strict"
import { test } from "node:test"

import { completeAt, type CompletionLanguage } from "./completion.ts"

/** Completions where `|` is in the source. */
const at = (
  language: CompletionLanguage,
  source: string,
  others: { path: string; content: string }[] = []
) => {
  const offset = source.indexOf("|")
  const content = source.replace("|", "")
  const path = language === "java" ? "Main.java" : `main.${language}`
  return completeAt({
    language,
    files: [{ path, content }, ...others],
    path,
    offset,
  })
}
const labels = (items: { label: string }[]) => items.map((i) => i.label)

/* ---------- C++ ---------- */

test("a vector's members after a dot, from its declared type", () => {
  const items = at(
    "cpp",
    "#include <vector>\nint main() {\n  std::vector<int> v;\n  v.|\n}"
  )
  assert.ok(labels(items).includes("push_back"))
  assert.ok(labels(items).includes("size"))
  assert.ok(!labels(items).includes("first"), "only the vector's")
  const push = items.find((i) => i.label === "push_back")!
  assert.equal(push.insert, "push_back($0)")
  assert.equal(push.snippet, true)
  assert.equal(items.find((i) => i.label === "size")!.insert, "size()")
})

test("with using namespace std, templates nested, and parameters by reference", () => {
  const src = `using namespace std;
void go(map<string, vector<int>>& g, string s) {
  g.|
}`
  assert.ok(labels(at("cpp", src)).includes("lower_bound"))
  assert.ok(labels(at("cpp", src.replace("g.|", "s.|"))).includes("substr"))
})

test("an element of a vector has the element's members", () => {
  const items = at("cpp", "vector<string> words;\nint main() { words[0].| }")
  assert.ok(labels(items).includes("substr"))
  const pairs = at("cpp", "vector<pair<int,int>> ps;\nint main() { ps[i].| }")
  assert.deepEqual(labels(pairs).sort(), ["first", "second", "swap"])
})

test("typedefs and #defines lead to the real type", () => {
  assert.ok(
    labels(
      at("cpp", "typedef vector<long long> vl;\nvl a;\nint main() { a.| }")
    ).includes("push_back")
  )
  assert.ok(
    labels(
      at("cpp", "using vi = std::vector<int>;\nvi a;\nint main() { a.| }")
    ).includes("push_back")
  )
})

test("std:: offers the library", () => {
  const items = labels(at("cpp", "int main() { std::| }"))
  for (const name of ["sort", "vector", "cout", "max_element"])
    assert.ok(items.includes(name), name)
})

test("a struct's own fields and methods", () => {
  const src = `struct Edge { int to; long long w; bool heavy() const { return w > 9; } };
int main() { Edge e; e.| }`
  assert.deepEqual(labels(at("cpp", src)).sort(), ["heavy", "to", "w"])
  const ptr = `struct Node { int val; Node* next; };
int main() { Node* n; n->| }`
  assert.deepEqual(labels(at("cpp", ptr)).sort(), ["next", "val"])
})

test("headers after #include <", () => {
  const items = labels(at("cpp", "#include <vec|"))
  assert.ok(items.includes("vector") && items.includes("bits/stdc++.h"))
  assert.ok(labels(at("c", "#include <|")).includes("stdio.h"))
  assert.ok(!labels(at("c", "#include <|")).includes("vector"))
})

test("a word: the file's own names, keywords, snippets and the library", () => {
  const src = `using namespace std;
int countPairs(int n) { return n; }
int main() {
  int total = 0;
  long long best;
  |
}`
  const items = labels(at("cpp", src))
  for (const name of [
    "countPairs",
    "total",
    "best",
    "while",
    "for",
    "vector",
    "sort",
    "printf",
  ])
    assert.ok(items.includes(name), name)
  assert.equal(new Set(items).size, items.length, "no repeats")
})

test("without using namespace std, std's names wait for std::", () => {
  const items = labels(at("cpp", "int main() {\n  |\n}"))
  assert.ok(!items.includes("sort") && items.includes("printf"))
})

test("comments and strings don't count as code", () => {
  const src = `// vector<int> fake;
int main() { const char* s = "vector<int> nope;"; fake.| }`
  assert.deepEqual(at("cpp", src), [])
})

test("names from the student's other files", () => {
  const items = labels(
    at("cpp", '#include "util.h"\nint main() { | }', [
      {
        path: "util.h",
        content: "int gcdOf(int a, int b);\nstruct Point { int x, y; };",
      },
    ])
  )
  assert.ok(items.includes("gcdOf") && items.includes("Point"))
  const fields = labels(
    at("cpp", "int main() { Point p; p.| }", [
      { path: "util.h", content: "struct Point { int x, y; };" },
    ])
  )
  assert.deepEqual(fields.sort(), ["x", "y"])
})

test("C: its own keywords and functions, no C++", () => {
  const items = labels(at("c", "int main() { | }"))
  assert.ok(items.includes("printf") && items.includes("strlen"))
  assert.ok(!items.includes("class") && !items.includes("vector"))
})

/* ---------- Java ---------- */

test("Java: an object's members from its declared type", () => {
  const src = `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    Map<String, List<Integer>> seen = new HashMap<>();
    sc.|
  }
}`
  assert.ok(labels(at("java", src)).includes("nextInt"))
  assert.ok(
    labels(at("java", src.replace("sc.|", "seen.|"))).includes("getOrDefault")
  )
})

test("Java: var takes the type it's made from; arrays have length and their elements", () => {
  const src = `class Main { void f() { var q = new ArrayDeque<Integer>(); q.| } }`
  assert.ok(labels(at("java", src)).includes("pollFirst"))
  const arr = `class Main { void f() { int[] a = new int[5]; a.| } }`
  assert.deepEqual(labels(at("java", arr)), ["length"])
  const parts = `class Main { void f(String line) { String[] parts = line.split(" "); parts[0].| } }`
  assert.ok(labels(at("java", parts)).includes("charAt"))
})

test("Java: a class's statics, and System.out", () => {
  assert.ok(
    labels(at("java", "class Main { void f() { Math.| } }")).includes("max")
  )
  assert.ok(
    labels(at("java", "class Main { void f() { Integer.| } }")).includes(
      "parseInt"
    )
  )
  assert.deepEqual(
    labels(at("java", "class Main { void f() { System.out.| } }")).sort(),
    ["flush", "print", "printf", "println"]
  )
})

test("Java: the student's own class, its fields and methods", () => {
  const src = `class Edge { int to; long w; int other(int v) { return v; } }
public class Main { void f() { Edge e = new Edge(); e.| } }`
  assert.deepEqual(labels(at("java", src)).sort(), ["other", "to", "w"])
})

test("Java: imports", () => {
  assert.ok(labels(at("java", "import java.util.|")).includes("Scanner"))
  assert.ok(labels(at("java", "import java.|")).includes("util"))
})

test("Java: a word gives names, keywords, classes and snippets", () => {
  const src = `public class Main {
  static int best(int[] a) { return 0; }
  public static void main(String[] args) {
    int count = 0;
    |
  }
}`
  const items = labels(at("java", src))
  for (const name of [
    "best",
    "count",
    "args",
    "Scanner",
    "ArrayList",
    "public",
    "sout",
  ])
    assert.ok(items.includes(name), name)
})
