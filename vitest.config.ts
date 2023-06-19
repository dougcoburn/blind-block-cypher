// vite.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['**'],
      exclude: [],
      reporter: ['text', 'json', 'html'],
      all: true,
      lines: 100,
      functions: 100,
      branches: 100,
      statements: 100
    },
  },
})
