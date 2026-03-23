import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    // Each test file imports `app` from index.ts which calls app.listen().
    // Running files in parallel causes EADDRINUSE. Use sequential file execution.
    fileParallelism: false,
    // Use a single pool thread so the server port is reused (not duplicated).
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
