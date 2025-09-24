import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/integration/**/*.spec.ts',
      'tests/concurrency/**/*.spec.ts',
      'tests/cli/**/*.spec.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      'test/**/*.test.ts'
    ],
                testTimeout: 120000,
                hookTimeout: 120000,
                teardownTimeout: 120000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
