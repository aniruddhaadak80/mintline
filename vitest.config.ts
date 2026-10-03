import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PGlite needs a real filesystem for its data directory, and the embedded
    // adapter is exercised by the integration suite.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});