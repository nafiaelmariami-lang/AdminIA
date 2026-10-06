import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as registerRoute from "@/app/api/auth/register/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as forgotRoute from "@/app/api/auth/password/forgot/route";
import { users } from "@/server/db/schema";
import { resetConfigForTests } from "@/server/config";
import { HONEYPOT_FIELD } from "@/lib/honeypot";
import { apiRequest, memoryEmail, setupTestApp, signUp, tokenFrom, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());
afterEach(() => {
  delete process.env.TRUST_PROXY;
  resetConfigForTests();
});

const post = (path: string, json: unknown, ip?: string) => apiRequest(path, { method: "POST", json, headers: ip ? { "x-forwarded-for": ip } : {} });
const login = (email: string, password: string, ip?: string) => loginRoute.POST(post("/api/auth/login", { email, password }, ip), undefined);

describe("champ piège anti-robots", () => {
  it("inscription : refusée si le champ piège est rempli, aucun compte créé ; acceptée s'il est vide", async () => {
    const email = `robot-${Date.now()}@exemple.fr`;
    const base = { email, password: "Un-Mot-De-Passe-Solide-42", name: "Robot", acceptTerms: true };
    for (const value of ["https://spam.example", "x", 1, true]) {
      const res = await registerRoute.POST(post("/api/auth/register", { ...base, [HONEYPOT_FIELD]: value }), undefined);
      expect(res.status).toBe(400);
    }
    expect(await app.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    expect(memoryEmail.lastTo(email)).toBeUndefined();
    const ok = await registerRoute.POST(post("/api/auth/register", { ...base, [HONEYPOT_FIELD]: "" }), undefined);
    expect(ok.status).toBe(201);
  });

  it("mot de passe oublié : même réponse, mais aucun e-mail envoyé au robot", async () => {
    const u = await signUp(app);
    const before = memoryEmail.sent.length;
    const bot = await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email, [HONEYPOT_FIELD]: "spam" }), undefined);
    expect(memoryEmail.sent.length).toBe(before);
    const human = await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email, [HONEYPOT_FIELD]: "" }), undefined);
    expect(bot.status).toBe(human.status);
    expect(await bot.json()).toEqual(await human.json());
    expect(memoryEmail.lastTo(u.email)?.tag).toBe("reset_password");
  });
});

describe("verrouillage de connexion derrière un proxy de confiance", () => {
  it("un tiers qui échoue 10 fois depuis son IP ne bloque pas le titulaire depuis une autre IP", async () => {
    process.env.TRUST_PROXY = "true";
    resetConfigForTests();
    const u = await signUp(app);
    for (let i = 0; i < 10; i++) expect((await login(u.email, `Faux-Mot-De-Passe-${i}`, "203.0.113.7")).status).toBe(401);
    // L'attaquant est bloqué, même avec le bon mot de passe.
    expect((await login(u.email, u.password, "203.0.113.7")).status).toBe(429);
    // Le titulaire, depuis son IP, se connecte normalement.
    const owner = await login(u.email, u.password, "198.51.100.20");
    expect(owner.status).toBe(200);
    expect(tokenFrom(owner)).toBeTruthy();
  });

  it("attaque répartie sur de nombreuses IP : plafond par compte", async () => {
    process.env.TRUST_PROXY = "true";
    resetConfigForTests();
    const u = await signUp(app);
    let blocked = false;
    for (let i = 0; i < 110 && !blocked; i++) {
      const res = await login(u.email, "Faux-Mot-De-Passe-1", `192.0.2.${i % 250}`);
      blocked = res.status === 429;
    }
    expect(blocked).toBe(true);
  });

  it("sans proxy de confiance, l'en-tête X-Forwarded-For est ignoré (pas de contournement)", async () => {
    const u = await signUp(app);
    for (let i = 0; i < 10; i++) await login(u.email, `Faux-Mot-De-Passe-${i}`, `10.0.0.${i}`);
    expect((await login(u.email, u.password, "10.0.0.99")).status).toBe(429);
  });
});
