import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  use: { baseURL: "http://localhost:4173", viewport: { width: 1400, height: 900 } },
  webServer: { command: "npx vite build && npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
