import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  workers: process.env.KLIKILIG_MEDIA_TEST === "1" ? 1 : 2,
  use: {
    actionTimeout: 20000,
    baseURL: process.env.APP_ORIGIN || "http://localhost:3000",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: {
    command: "npm run start",
    url: process.env.APP_ORIGIN || "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
