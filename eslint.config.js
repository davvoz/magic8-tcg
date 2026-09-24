import js from "@eslint/js";

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  HTMLCanvasElement: "readonly",
  CanvasRenderingContext2D: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  localStorage: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  globalThis: "readonly",
  Storage: "readonly",
  performance: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  URL: "readonly",
  WebSocket: "readonly",
  location: "readonly",
};

const nodeGlobals = {
  fetch: "readonly",
  process: "readonly",
  Response: "readonly",
  DOMException: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  TextEncoder: "readonly",
  structuredClone: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  structuredClone: "readonly",
  console: "readonly",
  performance: "readonly",
};

/** Rules mirroring the SonarQube checks we care about most (see docs/ARCHITECTURE.md §1.7). */
const qualityRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "eqeqeq": ["error", "always"],
  "no-param-reassign": ["error", { props: true }],
  "no-nested-ternary": "error",
  "no-console": "error",
  "no-var": "error",
  "prefer-const": "error",
  "complexity": ["error", 12],
  "max-depth": ["error", 3],
  "max-params": ["error", 4],
  "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  "no-empty": "error",
  "no-empty-function": "error",
  "no-else-return": "error",
  "no-lonely-if": "error",
  "no-throw-literal": "error",
  "no-shadow": "error",
  "no-prototype-builtins": "error",
  "curly": ["error", "all"],
};

export default [
  js.configs.recommended,
  {
    files: ["packages/client/src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: browserGlobals },
    rules: qualityRules,
  },
  {
    // The rules engine and the client's application layer must stay platform-agnostic.
    files: ["packages/engine/src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: {} },
    rules: qualityRules,
  },
  {
    // Protocol code runs in Node and in the browser (public verification): only globals both provide.
    files: ["packages/protocol/src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { TextEncoder: "readonly", structuredClone: "readonly" } },
    rules: qualityRules,
  },
  {
    // Chain adapters: standard web platform APIs available in Node 22 (fetch, timers, encoders).
    files: ["packages/steem/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { fetch: "readonly", AbortController: "readonly", setTimeout: "readonly", clearTimeout: "readonly", TextEncoder: "readonly", TextDecoder: "readonly", URL: "readonly", Response: "readonly" },
    },
    rules: qualityRules,
  },
  {
    files: ["packages/server/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...nodeGlobals, setInterval: "readonly", clearInterval: "readonly", setTimeout: "readonly", TextDecoder: "readonly", TextEncoder: "readonly", fetch: "readonly" },
    },
    rules: qualityRules,
  },
  {
    files: ["packages/client/src/application/**/*.js"],
    languageOptions: { globals: {} },
  },
  {
    // Presentation layers mutate objects they are handed by design: the Canvas 2D API is driven by
    // setting properties on the passed-in context, and a retained widget tree sets parent/hover/focus
    // state on its nodes. Reassigning the parameter itself stays forbidden (matches Sonar S1226).
    files: ["packages/client/src/rendering/**/*.js", "packages/client/src/input/**/*.js"],
    rules: { "no-param-reassign": ["error", { props: false }] },
  },
  {
    // The console-backed Logger implementation is the single sanctioned use of console in src/.
    files: ["packages/client/src/infrastructure/logging/ConsoleLogger.js"],
    languageOptions: { globals: { console: "readonly" } },
    rules: { "no-console": "off" },
  },
  {
    files: ["packages/*/test/**/*.js", "packages/*/tools/**/*.js", "tools/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: nodeGlobals },
    rules: { ...qualityRules, "no-console": "off" },
  },
  {
    // The preview harness runs in the browser (it boots the real presentation stack for screenshots).
    files: ["packages/client/tools/preview/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: browserGlobals },
    rules: qualityRules,
  },
];
