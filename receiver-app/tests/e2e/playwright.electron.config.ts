import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  projects: [
    {
      name: 'electron',
      use: {
        // We will implement an Electron launcher later
      },
    },
  ],
});

