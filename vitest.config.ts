// vite.config.ts
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

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
} as any);

/* eslint-enable @typescript-eslint/no-unsafe-call */
/* eslint-enable @typescript-eslint/no-explicit-any */
/* eslint-enable @typescript-eslint/no-unsafe-argument */
