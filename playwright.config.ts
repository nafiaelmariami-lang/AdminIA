import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout dans un vrai navigateur, contre un serveur déjà lancé.
 * Usage : E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 */
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Un seul navigateur à la fois : les tests partagent un serveur et ses interrupteurs globaux
  // (le parcours d'administration ferme brièvement les inscriptions).
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
});
