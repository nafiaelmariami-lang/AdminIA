import { afterEach, describe, expect, it } from "vitest";
import { getConfig, resetConfigForTests } from "@/server/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetConfigForTests();
});

function prodEnv(extra: Record<string, string> = {}) {
  process.env = {
    ...saved,
    NODE_ENV: "production",
    DATABASE_URL: "postgres://u:p@localhost/db",
    STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    EMAIL_DRIVER: "brevo",
    BREVO_API_KEY: "cle",
    EMAIL_FROM: "contact@adminia.fr",
    ...extra,
  };
  resetConfigForTests();
}

describe("garde-fous de configuration en production", () => {
  it("accepte une configuration de production complète", () => {
    prodEnv();
    expect(getConfig().EMAIL_DRIVER).toBe("brevo");
  });

  it.each([
    ["sans clé de chiffrement", { STORAGE_ENCRYPTION_KEY: "" }],
    ["clé de chiffrement de mauvaise taille", { STORAGE_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }],
    ["base PGlite", { DATABASE_URL: "pglite://./x" }],
    ["boîte d'envoi locale", { EMAIL_DRIVER: "outbox" }],
    ["expéditeur .local", { EMAIL_FROM: "x@adminia.local" }],
    ["Brevo sans clé", { BREVO_API_KEY: "" }],
    ["Anthropic sans clé", { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "" }],
    ["URL invalide", { APP_URL: "pas une url" }],
  ])("refuse : %s", (_label, extra) => {
    prodEnv(extra);
    expect(() => getConfig()).toThrow();
  });
});
