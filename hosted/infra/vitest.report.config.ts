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
        include: ["lib/**/*.ts", "bin/**/*.ts"],
        exclude: ["**/*.test.ts", "**/*.d.ts", "**/dist/**"],
      },
    },
  }),
);
