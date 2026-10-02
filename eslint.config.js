import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  HTMLCanvasElement: "readonly",
  Image: "readonly",
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
  navigator: "readonly",
};

/** What the service worker (packages/client/sw.js) runs with. */
const serviceWorkerGlobals = {
  self: "readonly",
  caches: "readonly",
  fetch: "readonly",
  URL: "readonly",
};

const nodeGlobals = {
  fetch: "readonly",
  process: "readonly",
  Response: "readonly",
  Headers: "readonly",
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
    // Standalone pages next to the client (the game verifier, the manifest tool).
    files: ["packages/client/verify/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...browserGlobals, URLSearchParams: "readonly" } },
    rules: qualityRules,
  },
  {
    // The service worker: a classic script with its own globals, served from the site root.
    files: ["packages/client/sw.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: serviceWorkerGlobals },
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
    // SonarJS rules (the SonarQube JavaScript analyzer's checks) on every source file and tool.
    files: ["packages/*/src/**/*.js", "packages/client/verify/**/*.js", "packages/client/tools/**/*.js", "tools/**/*.js"],
    plugins: { sonarjs },
    rules: sonarjs.configs.recommended.rules,
  },
  {
    // Server: amounts are exact integers (never floats), and untrusted JSON goes through the safe parser (docs/tcg/05 §6).
    files: ["packages/server/src/**/*.js"],
    ignores: ["packages/server/src/kernel/json.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name='parseFloat'], MemberExpression[property.name='parseFloat']", message: "Amounts are integers in minimal units: use economy Money parsing, never parseFloat." },
        { selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']", message: "Parse untrusted JSON with kernel/json.js parseJson (prototype keys, depth)." },
      ],
    },
  },
  {
    // The preview harness runs in the browser (it boots the real presentation stack for screenshots).
    files: ["packages/client/tools/preview/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: browserGlobals },
    rules: qualityRules,
  },
];
