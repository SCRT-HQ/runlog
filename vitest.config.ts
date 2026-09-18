import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";

export default defineConfig({
  // The guide's pages are MDX; the app's tests render them.
  plugins: [{ enforce: "pre", ...mdx({ jsxImportSource: "react", remarkPlugins: [remarkGfm] }) }],
  resolve: {
    alias: {
      // The loader's own entry, before the package's: an alias matches by
      // prefix, so the bare one would swallow the subpath. The plugin
      // imports it that way to keep the signing and the container out of
      // its one bundled file.
      "@runlog/rules-schema/load": fileURLToPath(new URL("./packages/rules-schema/src/load.ts", import.meta.url)),
      "@runlog/rules-schema": fileURLToPath(new URL("./packages/rules-schema/src/index.ts", import.meta.url)),
      "@runlog/engine": fileURLToPath(new URL("./packages/engine/src/index.ts", import.meta.url)),
      "@runlog/container": fileURLToPath(new URL("./packages/container/src/index.ts", import.meta.url)),
      "@runlog/deck-profiles": fileURLToPath(new URL("./packages/deck-profiles/src/index.ts", import.meta.url)),
      "@runlog/themes": fileURLToPath(new URL("./packages/themes/src/index.ts", import.meta.url)),
    },
  },
  define: {
    __RUNLOG_VERSION__: JSON.stringify("test"),
    __RUNLOG_SHA__: JSON.stringify(""),
  },
  test: {
    environment: "node",
    // Tells storage that a test run has nobody signed in; see tests/setup.ts.
    setupFiles: ["./tests/setup.ts"],
    // @elgato/streamdeck rotates a shared logs/<uuid>.N.log file on import, so its
    // action tests race each other under file parallelism (ENOENT or EPERM on the
    // rename). Everything else stays parallel; the plugin's tests run one file at a time.
    projects: [
      {
        extends: true,
        test: {
          name: "default",
          include: [
            "packages/*/src/**/*.test.ts",
            "apps/*/src/**/*.test.{ts,tsx}",
            // Build-time modules live beside the config they serve, not in src.
            "apps/*/*.test.ts",
            // The plugin's design scripts, which live beside what they generate.
            "streamdeck/design/**/*.test.mjs",
            "tests/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "streamdeck",
          include: ["streamdeck/src/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
