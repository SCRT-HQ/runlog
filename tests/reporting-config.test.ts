import { describe, expect, it } from "vitest";

async function loadReportConfig(path: string) {
  try {
    return (await import(path)).default;
  } catch (error) {
    throw new Error(`Could not load ${path}`, { cause: error });
  }
}

describe("test reporting configuration", () => {
  it("keeps the root suite reports portable and includes untested source in coverage", async () => {
    const config = await loadReportConfig(new URL("../vitest.report.config.ts", import.meta.url).href);

    expect(config.test?.reporters).toEqual([
      "default",
      ["junit", { outputFile: "junit.xml" }],
      ["html", { outputDir: "reports/tests", singleFile: true }],
    ]);
    expect(config.test?.coverage).toMatchObject({
      enabled: true,
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      reportOnFailure: true,
      include: [
        "packages/*/src/**/*.{ts,tsx}",
        "apps/*/src/**/*.{ts,tsx}",
        "streamdeck/src/**/*.{ts,tsx}",
        "packages/*/scripts/**/*.ts",
        "apps/*/*.{ts,tsx}",
        "streamdeck/design/**/*.mjs",
      ],
    });
    expect(config.test?.coverage?.exclude).toEqual(
      expect.arrayContaining(["**/*.test.{ts,tsx,mjs}", "**/*.d.ts", "**/dist/**", "**/stage/**"]),
    );
  });

  it("keeps the hosting reports separate and limits coverage to its lib and bin source", async () => {
    const config = await loadReportConfig(new URL("../hosted/infra/vitest.report.config.ts", import.meta.url).href);

    expect(config.test?.reporters).toEqual([
      "default",
      ["junit", { outputFile: "junit.xml" }],
      ["html", { outputDir: "reports/tests", singleFile: true }],
    ]);
    expect(config.test?.coverage).toMatchObject({
      enabled: true,
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      reportOnFailure: true,
      include: ["lib/**/*.ts", "bin/**/*.ts"],
    });
    expect(config.test?.coverage?.exclude).toEqual(expect.arrayContaining(["**/*.test.ts", "**/*.d.ts", "**/dist/**"]));
  });
});
