import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as devLinkRoute from "@/app/api/dev/verification-link/route";
import * as verifyRoute from "@/app/api/auth/verify-email/route";
import { OutboxEmailSender, setEmailSenderForTests } from "@/server/email";
import { resetConfigForTests } from "@/server/config";
import { apiRequest, memoryEmail, setupTestApp, signUp, type TestApp } from "./helpers";

let app: TestApp;
let outbox: string;
const saved = { NODE_ENV: process.env.NODE_ENV, EMAIL_OUTBOX_DIR: process.env.EMAIL_OUTBOX_DIR, EMAIL_DRIVER: process.env.EMAIL_DRIVER };
const env = process.env as Record<string, string | undefined>;

beforeAll(async () => {
  app = await setupTestApp();
  outbox = await mkdtemp(path.join(tmpdir(), "adminia-outbox-"));
});
afterAll(async () => {
  await rm(outbox, { recursive: true, force: true });
  await app.close();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  resetConfigForTests();
  setEmailSenderForTests(memoryEmail);
});

function devMode() {
  env.NODE_ENV = "development";
  env.EMAIL_DRIVER = "outbox";
  env.EMAIL_OUTBOX_DIR = outbox;
  resetConfigForTests();
  setEmailSenderForTests(new OutboxEmailSender(outbox));
}

const getLink = (token: string) => devLinkRoute.GET(apiRequest("/api/dev/verification-link", { token }), undefined);

describe("aide de développement : confirmation sans e-mail réel", () => {
  it("en développement (pilote outbox), renvoie le lien de confirmation de l'utilisateur connecté, qui active bien le compte", async () => {
    devMode();
    const u = await signUp(app, { verified: false });
    const res = await getLink(u.token);
    expect(res.status).toBe(200);
    const { link } = (await res.json()) as { link: string };
    expect(link).toMatch(/^\/verifier-email\?token=[A-Za-z0-9_-]+$/);
    const token = new URL(link, "http://x").searchParams.get("token");
    expect((await verifyRoute.POST(apiRequest("/api/auth/verify-email", { method: "POST", json: { token } }), undefined)).status).toBe(200);
  });

  it("ne révèle jamais le lien d'un autre compte", async () => {
    devMode();
    const a = await signUp(app, { verified: false });
    const b = await signUp(app, { verified: false });
    const linkA = ((await (await getLink(a.token)).json()) as { link: string }).link;
    const linkB = ((await (await getLink(b.token)).json()) as { link: string }).link;
    expect(linkA).not.toBe(linkB);
    expect((await getLink("")).status).toBe(401);
  });

  it("introuvable (404) hors développement ou avec un vrai fournisseur d'e-mail", async () => {
    const u = await signUp(app, { verified: false });
    expect((await getLink(u.token)).status).toBe(404); // NODE_ENV=test
    Object.assign(env, {
      NODE_ENV: "production",
      STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      DATABASE_URL: "postgres://u:p@localhost/db",
      EMAIL_DRIVER: "brevo",
      BREVO_API_KEY: "cle",
      EMAIL_FROM: "contact@adminia.fr",
    });
    resetConfigForTests();
    expect((await getLink(u.token)).status).toBe(404);
    for (const k of ["STORAGE_ENCRYPTION_KEY", "DATABASE_URL", "BREVO_API_KEY", "EMAIL_FROM"]) delete env[k];
    env.NODE_ENV = "development";
    env.EMAIL_DRIVER = "disabled";
    resetConfigForTests();
    expect((await getLink(u.token)).status).toBe(404);
  });
});
