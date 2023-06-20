// vite.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      all: true,
      branches: 100,
      exclude: [],
      functions: 100,
      include: ["src/**/*.ts"],
      lines: 100,
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      statements: 100,
    },
  },
});
