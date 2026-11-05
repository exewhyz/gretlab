/**
 * Runs real hostile programs through the real sandbox and asserts the containment.
 * Needs Docker and the sandbox images: pnpm --filter runner test:sandbox
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { after, before, test } from "node:test"

import { judge, type JudgeRequest } from "../judge.ts"
import { backendFromEnv } from "./docker.ts"

const backend = backendFromEnv()
const python = (code: string, input = "", extra: Partial<JudgeRequest> = {}) =>
  judge(backend, {
    language: "python",
    files: [{ path: "main.py", content: code }],
    entry: "main.py",
    cases: [{ input, expected: null }],
    timeLimitMs: 4000,
    memoryLimitMb: 256,
    ...extra,
  })
const first = async (promise: ReturnType<typeof python>) => {
  const result = await promise
  assert.ok(result.cases[0], JSON.stringify(result))
  return result.cases[0]
}

before(async () => {
  await backend.verify()
  await backend.removeAll()
})
after(() => backend.removeAll())

test("every language compiles, runs modules and reads stdin", async () => {
  const py = await judge(backend, {
    language: "python",
    files: [
      {
        path: "main.py",
        content: "from pkg.helper import twice\nprint(twice(int(input())))",
      },
      { path: "pkg/helper.py", content: "def twice(x): return x * 2" },
    ],
    entry: "main.py",
    cases: [
      { input: "21", expected: "42" },
      { input: "2", expected: "5" },
    ],
    timeLimitMs: 4000,
    memoryLimitMb: 256,
  })
  assert.deepEqual(
    py.cases.map((c) => c.verdict),
    ["AC", "WA"]
  )
  assert.equal(py.verdict, "WA")

  const js = await judge(backend, {
    language: "javascript",
    files: [
      {
        path: "main.js",
        content:
          'const {t}=require("./lib/h.js");console.log(t(+require("fs").readFileSync(0,"utf8")))',
      },
      { path: "lib/h.js", content: "exports.t=x=>x*2" },
    ],
    entry: "main.js",
    cases: [{ input: "21", expected: "42" }],
    timeLimitMs: 5000,
    memoryLimitMb: 512,
  })
  assert.equal(js.verdict, "AC", JSON.stringify(js))

  const cpp = await judge(backend, {
    language: "cpp",
    files: [
      {
        path: "main.cpp",
        content:
          '#include <iostream>\n#include "h.hpp"\nint main(){int x;std::cin>>x;std::cout<<twice(x);}',
      },
      { path: "h.hpp", content: "int twice(int);" },
      { path: "h.cpp", content: "int twice(int x){return x*2;}" },
    ],
    entry: "main.cpp",
    cases: [{ input: "21", expected: "42" }],
    timeLimitMs: 3000,
    memoryLimitMb: 512,
  })
  assert.equal(cpp.verdict, "AC", JSON.stringify(cpp))

  const c = await judge(backend, {
    language: "c",
    files: [
      {
        path: "main.c",
        content:
          '#include <stdio.h>\n#include <math.h>\nint main(){printf("%.0f",sqrt(1764));}',
      },
    ],
    entry: "main.c",
    cases: [{ input: "", expected: "42" }],
    timeLimitMs: 3000,
    memoryLimitMb: 512,
  })
  assert.equal(c.verdict, "AC", JSON.stringify(c))

  const java = await judge(backend, {
    language: "java",
    files: [
      {
        path: "Main.java",
        content:
          "public class Main{public static void main(String[] a){System.out.println(Helper.t(new java.util.Scanner(System.in).nextInt()));}}",
      },
      {
        path: "Helper.java",
        content: "public class Helper{static int t(int x){return x*2;}}",
      },
    ],
    entry: "Main.java",
    cases: [{ input: "21", expected: "42" }],
    timeLimitMs: 8000,
    memoryLimitMb: 768,
  })
  assert.equal(java.verdict, "AC", JSON.stringify(java))
})

test("compile errors are reported, not run", async () => {
  const result = await judge(backend, {
    language: "cpp",
    files: [{ path: "main.cpp", content: "int main( {" }],
    entry: "main.cpp",
    cases: [{ input: "", expected: "" }],
    timeLimitMs: 2000,
    memoryLimitMb: 512,
  })
  assert.equal(result.verdict, "CE")
  assert.match(result.compileOutput ?? "", /error/)
})

test("no network, including the host and internal services", async () => {
  const result = await first(
    python(`
import socket
for host, port in [("1.1.1.1", 53), ("host.docker.internal", 5433), ("172.17.0.1", 5433), ("169.254.169.254", 80)]:
    try:
        socket.create_connection((host, port), timeout=1)
        print("CONNECTED", host)
    except OSError:
        pass
import os
print(sorted(os.listdir("/sys/class/net")) if os.path.exists("/sys/class/net") else "no-net")
`)
  )
  assert.doesNotMatch(result.stdout, /CONNECTED/, result.stdout)
  assert.doesNotMatch(result.stdout, /eth0/, result.stdout)
})

test("root filesystem is read-only and the user is unprivileged", async () => {
  const result = await first(
    python(`
import os
print("uid", os.getuid())
for path in ["/etc/pwned", "/usr/bin/pwned", "/box/frozen/pwned"]:
    try:
        open(path, "w").close()
        print("WROTE", path)
    except OSError:
        pass
with open("/proc/self/status") as f:
    print("".join(l for l in f if l.startswith(("CapEff", "NoNewPrivs"))))
`)
  )
  assert.match(result.stdout, /uid 1000/)
  assert.doesNotMatch(result.stdout, /WROTE/, result.stdout)
  assert.match(result.stdout, /CapEff:\s+0+\n/, result.stdout)
  assert.match(result.stdout, /NoNewPrivs:\s+1/, result.stdout)
})

test("no Docker socket or host secrets are reachable", async () => {
  const result = await first(
    python(`
import os
print("socket", os.path.exists("/var/run/docker.sock"))
print("env", sorted(k for k in os.environ if any(s in k for s in ("DATABASE", "SECRET", "AUTH", "GOOGLE"))))
`)
  )
  assert.match(result.stdout, /socket False/)
  assert.match(result.stdout, /env \[\]/)
})

test("infinite loop is stopped at the limit", async () => {
  const result = await first(
    python("while True: pass", "", { timeLimitMs: 1500 })
  )
  assert.equal(result.verdict, "TLE")
  assert.ok(result.wallMs < 6000, String(result.wallMs))
})

test("a program that ignores signals and holds its pipes open is still stopped", async () => {
  const result = await first(
    python(
      `
import signal, os, time, sys
signal.signal(signal.SIGTERM, signal.SIG_IGN)
if os.fork() == 0:
    os.setsid()
    while True: time.sleep(1)
time.sleep(1000)
`,
      "",
      { timeLimitMs: 1500 }
    )
  )
  assert.equal(result.verdict, "TLE")
  assert.ok(result.wallMs < 8000, String(result.wallMs))
})

test("memory bomb is killed", async () => {
  const result = await first(
    python("x = []\nwhile True: x.append(bytearray(10_000_000))", "", {
      memoryLimitMb: 128,
      timeLimitMs: 10_000,
    })
  )
  assert.ok(["MLE", "RE"].includes(result.verdict), JSON.stringify(result))
  assert.ok(result.wallMs < 10_000, String(result.wallMs))
})

test("fork bomb is contained and the host keeps responding", async () => {
  const result = await first(
    python(
      `
import os, time
children = 0
try:
    while True:
        if os.fork() == 0:
            time.sleep(60)
            os._exit(0)
        children += 1
except OSError:
    print("stopped at", children)
`,
      "",
      { timeLimitMs: 4000 }
    )
  )
  // Either the PID limit refuses the fork, or (under gVisor) the sandbox itself is
  // stopped. Both are containment; what matters is no leak of runtime internals.
  const match = result.stdout.match(/stopped at (\d+)/)
  if (match) assert.ok(Number(match[1]) <= 256, match[1])
  else {
    assert.ok(["RE", "MLE"].includes(result.verdict), JSON.stringify(result))
    assert.doesNotMatch(result.stderr, /urpc|sandbox "|WaitPID/, result.stderr)
  }
  assert.equal(
    execFileSync("docker", ["version", "--format", "ok"]).toString().trim(),
    "ok"
  )
})

test("output flood is cut off", async () => {
  const result = await first(python('while True: print("x" * 10000)'))
  assert.equal(result.verdict, "OLE")
  assert.ok(result.stdout.length <= 70_000, String(result.stdout.length))
})

test("disk flood stops at the scratch limit", async () => {
  const result = await first(
    python(
      `
try:
    with open("big", "wb") as f:
        while True: f.write(b"x" * 1_000_000)
except OSError as e:
    print("limited")
`,
      "",
      { memoryLimitMb: 256, timeLimitMs: 8000 }
    )
  )
  assert.match(result.stdout, /limited/, JSON.stringify(result))
})

test("nothing survives between test cases", async () => {
  const code = `
import os, sys, time, glob
print("files", sorted(os.listdir(".")), sorted(os.listdir("/tmp")))
print("procs", len([p for p in os.listdir("/proc") if p.isdigit()]) < 12)
open("left_behind", "w").write("x")
open("/tmp/left_behind", "w").write("x")
open("main.py", "w").write("print('tampered')")
if os.fork() == 0:
    os.setsid()
    time.sleep(100)
`
  const result = await judge(backend, {
    language: "python",
    files: [{ path: "main.py", content: code }],
    entry: "main.py",
    cases: [
      { input: "", expected: null },
      { input: "", expected: null },
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
  })
  const second = result.cases[1]
  assert.ok(second)
  assert.match(
    second.stdout,
    /files \['main\.py'\] \[\]/,
    JSON.stringify(result)
  )
})

test("expected outputs never enter the sandbox", async () => {
  const secret = "HIDDEN_EXPECTED_OUTPUT_123"
  const result = await judge(backend, {
    language: "python",
    files: [
      {
        path: "main.py",
        content: `
import os
found = []
for base in ["/box", "/tmp", "."]:
    for root, dirs, names in os.walk(base):
        for name in names:
            try:
                if "${"HIDDEN"}" in open(os.path.join(root, name), errors="ignore").read():
                    found.append(name)
            except OSError:
                pass
print(found)
`.replace(/\n\s*\n/g, "\n"),
      },
    ],
    entry: "main.py",
    cases: [{ input: "", expected: secret }],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
  })
  assert.equal(result.verdict, "WA")
  assert.doesNotMatch(
    result.cases[0]?.stdout.replace(/HIDDEN/g, "") ?? "",
    /EXPECTED_OUTPUT/
  )
})

test("unsafe paths are rejected before reaching a sandbox", async () => {
  for (const path of [
    "../evil.py",
    "/etc/passwd",
    "a/../../b",
    "$(id).py",
    "a b.py",
    ".hidden",
    "x;rm -rf .py",
  ]) {
    await assert.rejects(
      judge(backend, {
        language: "python",
        files: [{ path, content: "" }],
        entry: path,
        cases: [],
        timeLimitMs: 1000,
        memoryLimitMb: 256,
      }),
      /Unsafe path/,
      path
    )
  }
})

test("no sandboxes are left behind", async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const left = execFileSync("docker", [
    "ps",
    "-aq",
    "--filter",
    "label=gretlab.sandbox=1",
  ])
    .toString()
    .trim()
  assert.equal(left, "")
})

test("reports the kernel it ran on", async () => {
  const result = await first(
    python(
      'import platform;print(platform.release());print(open("/proc/version").read())'
    )
  )
  console.log("sandbox kernel:", result.stdout.trim())
  if (process.env.SANDBOX_RUNTIME !== "runc") {
    assert.match(result.stdout, /gvisor/i, result.stdout)
  }
})
