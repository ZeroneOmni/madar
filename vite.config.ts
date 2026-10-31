import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";
import { remoteCacheUrl } from "./infra/task-cache/src/remoteCache.ts";

const DOM_TEST_ENVIRONMENT_ALLOWLIST: Array<string> = [];

const TEST_EXCLUDE = [
  "**/.repos/**",
  "**/.madar/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/.{idea,git,cache,output,temp}/**",
];

// Directories whose tests belong to a package's own test config.
const TEST_CONFIG_PACKAGES = ["apps/desktop", "apps/server", "apps/web", "packages/client-runtime"];

// `vp test run <file>` from the repo root hands each file to its package's
// config. Packages that borrow this config (`--config ../../vite.config.ts`) run
// from their own directory, as CI does, so they keep one plain project.
const isRepoRootTestRun = process.cwd() === import.meta.dirname;

const RESTRICTED_IMPORT_PATHS = [
  {
    name: "@madar/client-runtime",
    message:
      "Import from an explicit @madar/client-runtime/* subpath. The package has no root export.",
  },
  {
    name: "@pierre/diffs/react",
    importNames: ["CodeView"],
    message: "Use StyledDiffCodeView so web diff surfaces share styling and virtualized geometry.",
  },
];

const RESTRICTED_UI_VARIANT_PATTERNS = [
  {
    group: ["**/components/ui/*", "**/ui/*", "./ui/*"],
    importNames: ["buttonVariants", "toggleVariants", "badgeVariants", "selectTriggerVariants"],
    message:
      "Render the components/ui export instead of borrowing its class recipe (render={<Button …/>}, SelectButton, ToggleGroup).",
  },
];

// Vite+ supports remote configuration before its published types include it.
const cacheUrl = remoteCacheUrl(import.meta.dirname);
const taskCacheConfig = {
  scripts: false,
  ...(cacheUrl ? { remote: { url: cacheUrl } } : {}),
};

export default defineConfig({
  run: {
    cache: taskCacheConfig,
  },
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Fixture subprocesses must not inherit the outer task runner’s cache policy.
    env: { VP_REMOTE_CACHE: "off", VP_REMOTE_CACHE_URL: "" },
    exclude: TEST_EXCLUDE,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    allowOnly: !process.env.CI,
    // Flaky tests are fixed, not retried.
    retry: 0,
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
      ],
    },
    setupFiles: [
      NodeURL.fileURLToPath(
        new URL("./packages/shared/src/testing/longTempDir.ts", import.meta.url),
      ),
      NodeURL.fileURLToPath(
        new URL("./packages/shared/src/testing/providerEnv.ts", import.meta.url),
      ),
    ],
    ...(isRepoRootTestRun
      ? {
          projects: [
            ...TEST_CONFIG_PACKAGES,
            {
              extends: true,
              test: {
                name: "root",
                exclude: [...TEST_EXCLUDE, ...TEST_CONFIG_PACKAGES.map((dir) => `${dir}/**`)],
              },
            },
          ],
        }
      : {}),
  },
  staged: {
    "*": "node node_modules/vite-plus/bin/vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      ".repos/**",
      "infra/task-cache/vendor/**",
      // Macroscope requires one glob per line; Markdown formatting corrupts it.
      ".macroscope/ignore.md",
      ".alchemy",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "**/*.graphql.ts",
      "packages/source-control-github/schema/**",
      "apps/server/schema/**",
      "*.icon/**",
    ],
    sortPackageJson: {},
    overrides: [
      {
        files: [".devcontainer/devcontainer.json"],
        options: {
          trailingComma: "none",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: [
      ".repos",
      ".repos/**",
      // Imported skill tooling follows its upstream conventions, including through the Claude alias.
      ".agents/skills/**",
      ".claude/skills/**",
      "infra/task-cache/vendor/**",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "**/*.graphql.ts",
      "packages/source-control-github/schema/**",
      "apps/server/schema/**",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: ["./oxlint-plugin-madar/index.ts", "@shadcn/lint"],
    settings: {
      shadcn: { ui: "~/components/ui" },
    },
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "typescript/consistent-return": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/await-thenable": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "eslint/no-restricted-imports": ["error", { paths: RESTRICTED_IMPORT_PATHS }],
      "madar/no-global-process-runtime": "error",
      "madar/no-inline-schema-compile": "warn",
      "madar/no-low-value-comments": "error",
      "madar/no-manual-effect-runtime-in-tests": "error",
      "madar/no-native-title-tooltip": "error",
      // Test files only (the rule checks the filename).
      "madar/no-polling-loop-in-tests": "error",
      "madar/no-raw-mcp-registration": "error",
      "madar/no-real-time-wait-in-tests": "error",
      "madar/no-test-in-loop": "error",
      "madar/no-test-timeout-or-unreasoned-skip": "error",
      "madar/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }],
      "madar/no-unscoped-has": "error",
      "madar/no-wall-clock-in-tests": "error",
      "madar/namespace-node-imports": "error",
      "madar/prefer-catch-tags": "error",
      "madar/prefer-effect-fn": "error",
      "madar/require-centered-scroll-gutter": "error",
      "madar/require-suppression-reason": "error",
    },
    overrides: [
      {
        files: [
          "**/*.{test,spec,testkit}.{ts,tsx}",
          "**/{test,tests,testkit,testing,fixtures,integration}/**",
          "packages/provider-testing/**",
        ],
        rules: { "madar/prefer-effect-fn": "off" },
      },
      {
        files: ["apps/web/**/*.test.{ts,tsx}"],
        rules: { "madar/require-disposable-render": "error" },
      },
      {
        files: ["apps/web/src/**/*.browser.test.{ts,tsx}"],
        rules: { "madar/no-frame-waits-in-browser-tests": "error" },
      },
      {
        // Burn-down list: these files still have polling loops, so they stay at "warn".
        // Remove a file when you convert its loops. New polling loops in all other
        // test files fail lint. Do not add new files to this list.
        files: [
          "apps/server/src/background/HostPowerMonitor.test.ts",
          "apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.test.ts",
          "apps/server/src/orchestration-v2/FoundationPersistence.test.ts",
          "apps/server/src/project/ProjectEnrichmentService.test.ts",
          "apps/server/src/project/ProjectService.test.ts",
          "apps/server/src/scheduledTasks/ScheduledTaskService.webhook.test.ts",
          "apps/server/src/usage/UsageService.test.ts",
          "packages/client-runtime/src/connection/supervisor.test.ts",
          "packages/client-runtime/src/rpc/client.test.ts",
          "packages/client-runtime/src/rpc/session.test.ts",
          "packages/client-runtime/src/state/shell-sync.test.ts",
          "packages/client-runtime/src/state/threads-sync.test.ts",
          "packages/shared/src/atomicWrite.test.ts",
        ],
        rules: { "madar/no-polling-loop-in-tests": "warn" },
      },
      {
        files: ["apps/**/src/**", "packages/**/src/**"],
        excludeFiles: DOM_TEST_ENVIRONMENT_ALLOWLIST,
        rules: { "madar/no-dom-test-environment": "error" },
      },
      {
        files: ["packages/client-runtime/src/state/**", "apps/{web,desktop}/src/**"],
        rules: { "madar/no-rpc-permission-bypass": ["error", { allowRawClientAccess: false }] },
      },
      {
        files: [
          "packages/client-runtime/src/state/runtime.ts",
          "packages/client-runtime/src/state/vcsAction.ts",
        ],
        rules: {
          "madar/no-rpc-permission-bypass": [
            "error",
            { allowGuardInstallation: true, allowRawClientAccess: false },
          ],
        },
      },
      {
        files: [
          "apps/web/src/components/settings/AuthorizedClientsSettings.tsx",
          "apps/web/src/components/settings/ConnectionsSettings.tsx",
          "apps/web/src/components/device/DevicePhoneViewport.tsx",
          "apps/web/src/components/device/DeviceDuoViewport.tsx",
        ],
        rules: { "madar/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }] },
      },
      {
        files: ["packages/client-runtime/src/connection/outdatedHostUpdate.ts"],
        rules: { "madar/no-rpc-permission-bypass": "off" },
      },
      {
        files: [
          "packages/client-runtime/src/rpc/**",
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        ],
        rules: { "madar/no-rpc-permission-bypass": "off" },
      },
      {
        files: ["packages/shared/src/HostProcess.ts"],
        rules: { "madar/no-global-process-runtime": "off" },
      },
      {
        files: ["apps/server/src/mcp/McpHttpServer.ts"],
        rules: { "madar/no-raw-mcp-registration": "off" },
      },
      {
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/components/ui/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: RESTRICTED_IMPORT_PATHS,
              patterns: RESTRICTED_UI_VARIANT_PATTERNS,
            },
          ],
        },
      },
      {
        // The server and every client load a forge's shared definition, so a UI runtime
        // imported there would break the server; client-only forge code goes in `src/client/`.
        files: ["packages/source-control-*/src/shared/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: RESTRICTED_IMPORT_PATHS,
              patterns: [
                {
                  group: [
                    "react",
                    "react/*",
                    "react-*",
                    "expo",
                    "expo-*",
                    "lucide-react",
                    "@madar/client-runtime",
                    "@madar/client-runtime/*",
                    "../client/*",
                    "../server/*",
                    "../../client/*",
                    "../../server/*",
                    "../../../client/*",
                    "../../../server/*",
                    "@madar/source-control-*/client/*",
                    "@madar/source-control-*/server/*",
                  ],
                  message:
                    "Shared forge definitions load on the server and every client; keep UI and server code out.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/server/src/**", "packages/source-control-*/src/server/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: RESTRICTED_IMPORT_PATHS,
              patterns: [
                {
                  group: [
                    "@madar/source-control-*/client/*",
                    "../client/*",
                    "../../client/*",
                    "../../../client/*",
                  ],
                  message:
                    "A forge's client entry is UI-only; the server reads its `shared/definition`.",
                },
              ],
            },
          ],
        },
      },
      {
        // Raw ResizeObserver state commits miss the paint; observeResize flushes derived layout together.
        files: ["apps/web/src/**"],
        excludeFiles: [
          "apps/web/src/lib/observeResize.ts",
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        ],
        rules: { "madar/no-raw-resize-observer": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "shadcn/no-unknown-classes": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "madar/no-outset-state-indicators": "error" },
      },
      {
        files: ["apps/*/src/**", "packages/*/src/**"],
        excludeFiles: [
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
          "**/testkit/**",
          "**/_generated/**",
        ],
        rules: { "madar/no-em-dash-copy": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "shadcn/no-raw-colors": "error" },
      },
      {
        // Third-party marks must retain their exact colors.
        files: ["apps/web/src/components/Icons.tsx", "apps/web/src/components/JetBrainsIcons.tsx"],
        rules: { "shadcn/no-raw-colors": "off" },
      },
      {
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/components/ui/**"],
        rules: {
          "shadcn/require-static-classes": "error",
          "shadcn/no-arbitrary-values": [
            "error",
            {
              allow: [
                "layout",
                "transition",
                "rounded-[inherit]",
                "gap-[0.33em]",
                "px-[0.5em]",
                "rounded-[0.5em]",
                "text-[0.86em]",
                "rounded-[25%]",
                "text-[length:80cqh]",
                "bg-[Highlight]",
                "fill-[#26251E]",
                "fill-[#EDECEC]",
                "fill-[#0F0F0F]",
                "fill-[#F5F5F5]",
                "fill-[#d97757]",
                "text-[#d97757]",
              ],
            },
          ],
          "shadcn/no-restyle": [
            "error",
            {
              allow: ["layout"],
              contracts: [
                {
                  // CollapsibleTrigger has no styled counterpart; other triggers use render={<Button …/>}.
                  pattern: "^CollapsibleTrigger$",
                  allow: ["layout", "color", "typography", "spacing", "shape", "effects", "motion"],
                },
              ],
            },
          ],
        },
      },
      {
        // React Compiler owns memoization; upstream rules do not ban redundant useMemo/useCallback.
        files: ["apps/web/src/**/*.{ts,tsx}"],
        rules: {
          "react/exhaustive-effect-dependencies": "error",
          "react/globals": "error",
          "react/hooks": "error",
          "react/immutability": "error",
          // The compiler memoizes context values; this rule would ask for useMemo.
          "react/jsx-no-constructed-context-values": "off",
          "react/memo-dependencies": "error",
          "react/preserve-manual-memoization": "error",
          // oxlint 1.88 treats `new Date()` as impure (oxc#26894) and also flags it inside event
          // handlers (oxc#27309). The compiler we ship (oxc-transform-react) still compiles
          // those files, and reactCompilerCoverage.test.ts fails on real bailouts.
          "react/purity": "warn",
          "react/refs": "error",
          "react/set-state-in-effect": "error",
          "react/set-state-in-render": "error",
          "react/static-components": "error",
          "react/unsupported-syntax": "error",
          "madar/no-manual-memo": "error",
        },
      },
      {
        // The sign-in masthead is T3 brand artwork: fixed gradients, not theme surfaces.
        files: ["apps/web/src/components/auth/AuthSurfaceShell.tsx"],
        rules: { "shadcn/no-arbitrary-values": "off" },
      },
      {
        // React Compiler caches use* functions only if they call a hook.
        files: ["apps/web/src/**/*.{ts,tsx}"],
        excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
        rules: { "madar/no-hookless-use-function": "error" },
      },
    ],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
  },
});
