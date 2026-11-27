import { createRequire } from "node:module"
import babelParser from "@babel/eslint-parser"
import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import turboPlugin from "eslint-plugin-turbo"
import tseslint from "typescript-eslint"

const require = createRequire(import.meta.url)

/**
 * Rules that fail lint (and so CI). Everything else only warns: these are the ones whose
 * findings crash a page or break behaviour, never style.
 */
export const FAILING_RULES = ["react-hooks/rules-of-hooks"]

const asWarning = (setting) => {
  const level = Array.isArray(setting) ? setting[0] : setting
  const next = level === 2 || level === "error" ? "warn" : level
  return Array.isArray(setting) ? [next, ...setting.slice(1)] : next
}

/**
 * The configs with every rule downgraded to a warning except FAILING_RULES, which are errors.
 * (It replaced eslint-plugin-only-warn, which downgraded every rule with no exceptions.)
 *
 * @param {import("eslint").Linter.Config[]} configs
 * @returns {import("eslint").Linter.Config[]}
 */
export function warnExceptFailing(configs) {
  return [
    ...configs.map((c) =>
      c.rules
        ? {
            ...c,
            rules: Object.fromEntries(
              Object.entries(c.rules).map(([rule, setting]) => [
                rule,
                FAILING_RULES.includes(rule) ? setting : asWarning(setting),
              ])
            ),
          }
        : c
    ),
  ]
}

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = warnExceptFailing([
  // TypeScript too: without this, ESLint checks only .js files and skipped the whole app.
  { files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"] },
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [require.resolve("@babel/preset-typescript")],
        },
      },
    },
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    // TypeScript files read by TypeScript's own parser (Babel's can't follow types or JSX here).
    // Only the parser and its unused-variables rule: names are checked by the compiler, so
    // no-undef is off for them, as typescript-eslint advises.
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-undef": "off",
      // Overloads, and a type sharing a name with a value, are TypeScript, not redeclaring.
      "no-redeclare": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
  {
    ignores: ["dist/**"],
  },
])
