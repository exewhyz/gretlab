// Self-hosts the editor and formatters, so college networks that block CDNs still work.
import { cpSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const root = new URL("../", import.meta.url).pathname
const out = new URL("../public/vendor/", import.meta.url).pathname
const packageDir = (name) => join(root, "node_modules", name)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(packageDir("monaco-editor"), "min/vs"), join(out, "monaco/vs"), {
  recursive: true,
  filter: (path) => !path.endsWith(".map"),
})
cpSync(
  join(packageDir("@astral-sh/ruff-wasm-web"), "ruff_wasm_bg.wasm"),
  join(out, "ruff_wasm_bg.wasm")
)
cpSync(
  join(packageDir("@wasm-fmt/clang-format"), "clang-format.wasm"),
  join(out, "clang-format.wasm")
)
