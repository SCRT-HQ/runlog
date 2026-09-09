import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import { offline } from "./offline.ts";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// The version a deploy says it is — the release it becomes, or was cut
// from — else the package's own, which is what a local build is.
const version =
  process.env["RUNLOG_VERSION"] || (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

// Relative base so a built bundle works from a static host *and* from disk,
// which matters because one supported workflow is simply "open the file".
export default defineConfig(({ mode }) => {
  // A local dev server can stand in front of a hosted API: with
  // VITE_RUNLOG_API_ORIGIN in apps/web/.env.local (say the dev site), /api
  // and /ws are proxied there, so live links, sync and sign-in all work at
  // localhost exactly as they do hosted. Absent, the local copy has no API,
  // which is what a copy on disk is.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiOrigin = env["VITE_RUNLOG_API_ORIGIN"]?.replace(/\/$/, "");
  const proxy = apiOrigin
    ? {
        "/api": { target: apiOrigin, changeOrigin: true },
        "/ws": { target: apiOrigin.replace(/^http/, "ws"), changeOrigin: true, ws: true },
      }
    : undefined;
  return {
  // Relative by default, so the same build runs from a file and from a
  // subpath on a static host. The hosted build is made with RUNLOG_BASE=/
  // and lives at one root, which is what lets its pages be paths.
  base: process.env["RUNLOG_BASE"] ?? "./",
  // What build this is, for the error panel and the footer. The sha comes
  // from the publish workflow; a local build has none.
  define: {
    __RUNLOG_VERSION__: JSON.stringify(version),
    __RUNLOG_SHA__: JSON.stringify((process.env["RUNLOG_SHA"] ?? "").slice(0, 12)),
  },
  // MDX first, so the guide's pages reach the React plugin as JSX.
  plugins: [{ enforce: "pre", ...mdx({ jsxImportSource: "react" }) }, react(), offline()],
  resolve: {
    alias: {
      "@runlog/rules-schema": fileURLToPath(
        new URL("../../packages/rules-schema/src/index.ts", import.meta.url),
      ),
      "@runlog/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
      // The font files, by alias, so src/fonts.css can name exactly the
      // latin subsets it wants without a path into node_modules.
      "@font-literata": fileURLToPath(
        new URL("../../node_modules/@fontsource-variable/literata/files", import.meta.url),
      ),
      "@font-plex": fileURLToPath(
        new URL("../../node_modules/@fontsource/ibm-plex-mono/files", import.meta.url),
      ),
    },
  },
  server: { open: true, ...(proxy ? { proxy } : {}) },
  };
});
