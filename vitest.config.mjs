import { defineConfig } from 'vitest/config';

// Test runner config. App sources are not modified.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 20000,
    reporters: ['default', './tests/reporters/known-bugs.mjs'],
  },
});
