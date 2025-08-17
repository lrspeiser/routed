import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    reporters: 'default',
    coverage: {
      reporter: ['text', 'html'],
      provider: 'v8',
      include: [
        'main.js',
        'utils/**/*.js',
        'resources/runner/**/*.ts'
      ],
    },
    setupFiles: ['tests/vitest.setup.ts'],
  },
});

