import pluginReactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

import { config as baseConfig, warnExceptFailing } from "./base.js"

/**
 * A custom ESLint configuration for libraries that use React.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = warnExceptFailing([
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  pluginReactHooks.configs.flat.recommended,
])
