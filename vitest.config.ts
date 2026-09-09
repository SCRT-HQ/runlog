import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";

export default defineConfig({
  // The guide's pages are MDX; the app's tests render them.
  plugins: [{ enforce: "pre", ...mdx({ jsxImportSource: "react", remarkPlugins: [remarkGfm] }) }],
  resolve: {
    alias: {
      "@runlog/rules-schema": fileURLToPath(
        new URL("./packages/rules-schema/src/index.ts", import.meta.url),
      ),
      "@runlog/engine": fileURLToPath(
        new URL("./packages/engine/src/index.ts", import.meta.url),
      ),
      "@runlog/container": fileURLToPath(
        new URL("./packages/container/src/index.ts", import.meta.url),
      ),
    },
  },
  define: {
    __RUNLOG_VERSION__: JSON.stringify("test"),
    __RUNLOG_SHA__: JSON.stringify(""),
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.{ts,tsx}",
      // Build-time modules live beside the config they serve, not in src.
      "apps/*/*.test.ts",
      "tests/**/*.test.ts",
    ],
    environment: "node",
  },
});
