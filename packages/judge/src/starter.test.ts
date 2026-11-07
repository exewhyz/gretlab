import assert from "node:assert/strict"
import { test } from "node:test"

import { starterFromSolution } from "./starter.ts"

test("python: keeps input reading and function signatures, drops the logic", () => {
  const solution = `def shift(text, k):
    return text[k:] + text[:k]


text = input()
k = int(input())

print(shift(text, k))
`
  assert.equal(
    starterFromSolution("python", solution),
    `def shift(text, k):
    # Your code here
    pass

text = input()
k = int(input())

# Your code here
`
  )
})

test("python: a loop that reads input stays whole, try keeps its except", () => {
  const solution = `students = []
for _ in range(int(input())):
    students.append(input())
try:
    n = int(input())
except ValueError:
    n = 0
print(sorted(students), n)
`
  const starter = starterFromSolution("python", solution)
  assert.match(starter, /students = \[\]\nfor _ in range\(int\(input\(\)\)\):\n {4}students\.append\(input\(\)\)/)
  assert.match(starter, /try:\n {4}n = int\(input\(\)\)\nexcept ValueError:\n {4}n = 0/)
  assert.doesNotMatch(starter, /print/)
})

test("javascript: values parsed from input stay, copies of them don't", () => {
  const solution = `const [a, b] = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number)
let x = a
console.log(x + b)
`
  assert.equal(
    starterFromSolution("javascript", solution),
    `const [a, b] = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number)

// Your code here
`
  )
})

test("java: reads stay in main, other methods become stubs that still compile", () => {
  const solution = `import java.util.Scanner;

public class Main {
    static long square(int n) {
        return (long) n * n;
    }

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        System.out.println(square(n));
    }
}
`
  const starter = starterFromSolution("java", solution)
  assert.match(starter, /static long square\(int n\) \{\n {8}\/\/ Your code here\n {8}return 0;\n {4}\}/)
  assert.match(starter, /int n = in\.nextInt\(\);\n\n {8}\/\/ Your code here\n {4}\}/)
  assert.doesNotMatch(starter, /println/)
})

test("c: one-line helpers are emptied too, return 0 stays", () => {
  const solution = `#include <stdio.h>

int twice(int x) { return 2 * x; }

int main(void) {
    int n;
    scanf("%d", &n);
    printf("%d\\n", twice(n));
    return 0;
}
`
  const starter = starterFromSolution("c", solution)
  assert.match(starter, /int twice\(int x\) \{\n {4}\/\/ Your code here\n\}/)
  assert.match(starter, /scanf\("%d", &n\);\n\n {4}\/\/ Your code here\n\n {4}return 0;\n\}/)
  assert.doesNotMatch(starter, /printf/)
})

test("no solution, no starter", () => {
  assert.equal(starterFromSolution("cpp", "  \n"), "")
})

test("javascript: sorting or mapping input is logic, picking a line of it is reading", () => {
  const solution = `const lines = require("fs").readFileSync(0, "utf8").split("\\n")
const n = Number(lines[0])
const sorted = lines.slice(1).sort((a, b) => a[0] - b[0])
console.log(sorted.join(" "), n)
`
  const starter = starterFromSolution("javascript", solution)
  assert.match(starter, /const n = Number\(lines\[0\]\)/)
  assert.doesNotMatch(starter, /sorted/)
})

test("c: writing a file stays with the reading; reading that file back is logic", () => {
  const solution = `#include <stdio.h>

int main(void) {
    char line[64];
    FILE *file = fopen("notes.txt", "w");
    while (fgets(line, sizeof line, stdin)) fprintf(file, "%s", line);
    fclose(file);
    int count = 0;
    file = fopen("notes.txt", "r");
    while (fgets(line, sizeof line, file)) count++;
    printf("%d\\n", count);
    return 0;
}
`
  const starter = starterFromSolution("c", solution)
  assert.match(starter, /fprintf\(file, "%s", line\);/)
  assert.doesNotMatch(starter, /count/)
})
