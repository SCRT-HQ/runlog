import { defineConfig } from "vitest/config";

/**
 * The hosting's own test configuration. Without one, Vitest walks up to the
 * repository's, whose include patterns name the app's files and not these.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    environment: "node",
  },
});
