import { defineConfig, devices } from "@playwright/test";

// E2E for the AI 美化 feature. Assumes the dev server (port 3001) and the
// beautify proxy (port 8787) are already running:
//   (cd beautify-proxy && PORT=8787 node server.mjs)
//   (cd excalidraw-app && BROWSER=none yarn vite)
export default defineConfig({
  testDir: "./excalidraw-app/tests-e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
