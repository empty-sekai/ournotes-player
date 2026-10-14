// ESLint: the recommended rules over the sources, scripts, examples and tests (`npm run lint`). The player runs in
// browsers, the scripts and tests in Node.js; the Live2D and Spine runtimes are page scripts that define globals.
// The ports keep the statement order of the code they reproduce, including assignments a later branch overwrites, so
// no-useless-assignment is off.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser, ...globals.node,
        Live2DCubismCore: "readonly", Live2DCubismMotionSyncCore: "readonly", spine: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-useless-assignment": "off",
    },
  },
];
