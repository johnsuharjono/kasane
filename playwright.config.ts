import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1360, height: 900 },
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
  },
  projects: [
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
