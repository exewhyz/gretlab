/**
 * Every language the lab can run. Limits here are defaults: admins override them per
 * language from the dashboard (stored in the `languages` table).
 *
 * Commands run inside the sandbox, in the student's working directory. Shell strings
 * are fixed templates; student-chosen names only ever arrive after passing
 * SAFE_PATH in files.ts, which excludes every shell metacharacter.
 */
export interface LanguageDefinition {
  id: string
  label: string
  /** Sandbox image, built from docker/sandbox/<id>. */
  image: string
  /** Monaco language id. */
  editorLanguage: string
  extensions: string[]
  defaultEntry: string
  starter: string
  /** Omit for interpreted languages. */
  build?: (entry: string) => string[]
  run: (entry: string) => string[]
  defaults: { timeLimitMs: number; memoryLimitMb: number }
}

const c = (compiler: string, pattern: string, standard: string) => () => [
  "sh",
  "-c",
  `${compiler} -O2 -std=${standard} -o main $(find . -name '${pattern}') -lm`,
]

export const LANGUAGES = {
  python: {
    id: "python",
    label: "Python 3.13",
    image: "gretlab/sandbox-python:1",
    editorLanguage: "python",
    extensions: [".py"],
    defaultEntry: "main.py",
    starter: "# Write your solution here\n",
    run: (entry) => ["python3", "-B", entry],
    defaults: { timeLimitMs: 5000, memoryLimitMb: 256 },
  },
  javascript: {
    id: "javascript",
    label: "JavaScript (Node 22)",
    image: "gretlab/sandbox-node:1",
    editorLanguage: "javascript",
    extensions: [".js", ".mjs", ".cjs"],
    defaultEntry: "main.js",
    starter:
      'const input = require("fs").readFileSync(0, "utf8")\n\nconsole.log(input)\n',
    run: (entry) => ["node", entry],
    defaults: { timeLimitMs: 5000, memoryLimitMb: 512 },
  },
  c: {
    id: "c",
    label: "C (GCC, C17)",
    image: "gretlab/sandbox-cpp:1",
    editorLanguage: "c",
    extensions: [".c", ".h"],
    defaultEntry: "main.c",
    starter: "#include <stdio.h>\n\nint main(void) {\n    return 0;\n}\n",
    build: c("gcc", "*.c", "c17"),
    run: () => ["./main"],
    defaults: { timeLimitMs: 2000, memoryLimitMb: 512 },
  },
  cpp: {
    id: "cpp",
    label: "C++ (G++, C++20)",
    image: "gretlab/sandbox-cpp:1",
    editorLanguage: "cpp",
    extensions: [".cpp", ".cc", ".hpp", ".h"],
    defaultEntry: "main.cpp",
    starter: "#include <iostream>\n\nint main() {\n    return 0;\n}\n",
    build: c("g++", "*.cpp", "c++20"),
    run: () => ["./main"],
    defaults: { timeLimitMs: 2000, memoryLimitMb: 512 },
  },
  java: {
    id: "java",
    label: "Java 21",
    image: "gretlab/sandbox-java:1",
    editorLanguage: "java",
    extensions: [".java"],
    defaultEntry: "Main.java",
    starter:
      "public class Main {\n    public static void main(String[] args) {\n    }\n}\n",
    build: () => ["sh", "-c", "javac -d . $(find . -name '*.java')"],
    run: (entry) => [
      "java",
      "-XX:+UseSerialGC",
      "-XX:TieredStopAtLevel=1",
      "-cp",
      ".",
      entry.replace(/\.java$/, "").replaceAll("/", "."),
    ],
    defaults: { timeLimitMs: 8000, memoryLimitMb: 768 },
  },
} satisfies Record<string, LanguageDefinition>

export type LanguageId = keyof typeof LANGUAGES

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[]

export function isLanguageId(value: string): value is LanguageId {
  return value in LANGUAGES
}
