/**
 * Vitest configuration for E2E tests.
 * Runs against real PDF files — heavier than unit tests.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 60_000, // PDF processing can be slow
    hookTimeout: 30_000, // beforeAll fixture loading
    sequence: { concurrent: false }, // Sequential (shared PDF resources)
    reporters: ['verbose'],
    globals: true,
    environment: 'node',
  },
});
