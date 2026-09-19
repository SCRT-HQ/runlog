import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      reporters: ["default", ["junit", { outputFile: "junit.xml" }], ["html", { outputDir: "reports/tests", singleFile: true }]],
      coverage: {
        enabled: true,
        provider: "v8",
        reportsDirectory: "coverage",
        reporter: ["text-summary", "html", "lcov", "json-summary"],
        reportOnFailure: true,
        // Include source that no test imports so the baseline describes the
        // product, not only the files the suite happened to exercise.
        include: [
          "packages/*/src/**/*.{ts,tsx}",
          "apps/*/src/**/*.{ts,tsx}",
          "streamdeck/src/**/*.{ts,tsx}",
          // Build-time modules with executable behavior live beside the
          // packages and apps they produce rather than under src.
          "packages/*/scripts/**/*.ts",
          "apps/*/*.{ts,tsx}",
          "streamdeck/design/**/*.mjs",
        ],
        exclude: ["**/*.test.{ts,tsx,mjs}", "**/*.d.ts", "**/*.config.{ts,js,mjs,cjs}", "**/dist/**", "**/stage/**"],
      },
    },
  }),
);
