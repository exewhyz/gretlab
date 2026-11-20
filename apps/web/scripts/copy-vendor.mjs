// Self-hosts the editor and formatters, so college networks that block CDNs still work.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
// The package ships no source maps, but a few files still point to them; browsers then
// fetch a missing file (a failed request in DevTools and Lighthouse). Drop those pointers.
const unmap = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) unmap(path)
    else if (entry.name.endsWith(".js")) {
      const text = readFileSync(path, "utf8")
      if (text.includes("sourceMappingURL="))
        writeFileSync(path, text.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"))
    }
  }
}
unmap(join(out, "monaco/vs"))
cpSync(
  join(packageDir("@astral-sh/ruff-wasm-web"), "ruff_wasm_bg.wasm"),
  join(out, "ruff_wasm_bg.wasm")
)
cpSync(
  join(packageDir("@wasm-fmt/clang-format"), "clang-format.wasm"),
  join(out, "clang-format.wasm")
)
