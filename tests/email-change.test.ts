import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as emailRoute from "@/app/api/account/email/route";
import * as confirmRoute from "@/app/api/auth/email-change/confirm/route";
import * as revertRoute from "@/app/api/auth/email-change/revert/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as resetRoute from "@/app/api/auth/password/reset/route";
import * as setupRoute from "@/app/api/account/2fa/setup/route";
import * as enableRoute from "@/app/api/account/2fa/enable/route";
import { authTokens, users } from "@/server/db/schema";
import { maskEmail } from "@/server/auth/email-change";
import { resetConfigForTests } from "@/server/config";
import { setStripeFetchForTests } from "@/server/billing/stripe";
import { runPurge } from "@/server/maintenance";
import { base32Decode, counterAt, hotp } from "@/server/auth/totp";
import { apiRequest, memoryEmail, setupTestApp, signUp, tokenFrom, tokenFromEmail, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());
beforeEach(() => {
  memoryEmail.fail = false;
});

const post = (path: string, json: unknown, token?: string) => apiRequest(path, { method: "POST", json, token });
const body = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const errorCode = async (res: Response) => (await body<{ error: { code: string } }>(res)).error.code;
const request = (token: string, json: unknown) => emailRoute.POST(post("/api/account/email", json, token), undefined);
const confirm = (token: string) => confirmRoute.POST(post("/api/auth/email-change/confirm", { token }), undefined);
const revert = (token: string) => revertRoute.POST(post("/api/auth/email-change/revert", { token }), undefined);
const me = (token: string) => meRoute.GET(apiRequest("/api/auth/me", { token }), undefined);
const login = (email: string, password: string) => loginRoute.POST(post("/api/auth/login", { email, password }), undefined);
const fresh = () => `nouvelle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.fr`;
const userRow = async (id: string) => (await app.db.select().from(users).where(eq(users.id, id)))[0]!;

describe("changement d'adresse e-mail", () => {
  it("parcours complet : demande, avertissement à l'ancienne adresse, confirmation, connexion avec la nouvelle", async () => {
    const u = await signUp(app);
    const newEmail = fresh();
    const res = await request(u.token, { newEmail: ` ${newEmail.toUpperCase()} `, password: u.password });
    expect(res.status).toBe(200);
    expect((await userRow(u.userId)).pendingEmail).toBe(newEmail);
    // Rien ne change avant confirmation.
    expect((await userRow(u.userId)).email).toBe(u.email);

    const warning = memoryEmail.lastTo(u.email);
    expect(warning?.tag).toBe("email_change_requested");
    expect(warning?.text).toContain(maskEmail(newEmail));
    expect(warning?.text).not.toContain(newEmail);
    const link = memoryEmail.lastTo(newEmail);
    expect(link?.tag).toBe("confirm_new_email");
    expect(link?.text).toContain("/confirmer-adresse?token=");

    const ok = await confirm(tokenFromEmail(link));
    expect(ok.status).toBe(200);
    expect(await body(ok)).toEqual({ email: newEmail });
    const row = await userRow(u.userId);
    expect(row).toMatchObject({ email: newEmail, pendingEmail: null, previousEmail: u.email });
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(memoryEmail.lastTo(u.email)?.tag).toBe("email_changed");
    expect(memoryEmail.lastTo(u.email)?.text).toContain("/annuler-changement-adresse?token=");

    // La session en cours reste valide ; connexion avec la nouvelle adresse seulement.
    expect((await me(u.token)).status).toBe(200);
    expect(tokenFrom(await login(newEmail, u.password))).toBeTruthy();
    expect((await login(u.email, u.password)).status).toBe(401);
    // Lien à usage unique
    expect((await confirm(tokenFromEmail(link))).status).toBe(400);
  });

  it("mot de passe exigé ; entrées invalides refusées ; même adresse refusée", async () => {
    const u = await signUp(app);
    expect((await request(u.token, { newEmail: fresh(), password: "Mauvais-Mot-De-Passe-1" })).status).toBe(401);
    expect((await request(u.token, { newEmail: "pas-une-adresse", password: u.password })).status).toBe(400);
    expect((await request(u.token, { newEmail: fresh() })).status).toBe(400);
    expect(await errorCode(await request(u.token, { newEmail: u.email, password: u.password }))).toBe("same_email");
    expect((await emailRoute.POST(post("/api/account/email", { newEmail: fresh(), password: u.password }), undefined)).status).toBe(401);
    expect((await userRow(u.userId)).pendingEmail).toBeNull();
  });

  it("adresse déjà inscrite : même réponse, aucun lien envoyé (pas d'énumération)", async () => {
    const owner = await signUp(app);
    const u = await signUp(app);
    const sentBefore = memoryEmail.sent.filter((m) => m.to === owner.email).length;
    const res = await request(u.token, { newEmail: owner.email, password: u.password });
    expect(res.status).toBe(200);
    const free = await body<{ message: string }>(await request((await signUp(app)).token, { newEmail: fresh(), password: "Un-Mot-De-Passe-Solide-42" }));
    expect((await body<{ message: string }>(res)).message).toBe(free.message);
    expect(memoryEmail.sent.filter((m) => m.to === owner.email).length).toBe(sentBefore);
  });

  it("adresse prise entre la demande et la confirmation : 409, rien ne change", async () => {
    const u = await signUp(app);
    const newEmail = fresh();
    await request(u.token, { newEmail, password: u.password });
    const token = tokenFromEmail(memoryEmail.lastTo(newEmail));
    await signUp(app, { email: newEmail });
    expect((await confirm(token)).status).toBe(409);
    expect((await userRow(u.userId)).email).toBe(u.email);
  });

  it("une nouvelle demande ou une annulation invalide le lien précédent", async () => {
    const u = await signUp(app);
    const a = fresh();
    const b = fresh();
    await request(u.token, { newEmail: a, password: u.password });
    const first = tokenFromEmail(memoryEmail.lastTo(a));
    await request(u.token, { newEmail: b, password: u.password });
    expect((await confirm(first)).status).toBe(400);
    const second = tokenFromEmail(memoryEmail.lastTo(b));
    expect((await emailRoute.DELETE(apiRequest("/api/account/email", { method: "DELETE", token: u.token }), undefined)).status).toBe(200);
    expect((await confirm(second)).status).toBe(400);
    expect((await userRow(u.userId)).pendingEmail).toBeNull();
  });

  it("avec la double authentification, un code est exigé en plus du mot de passe", async () => {
    const u = await signUp(app);
    const { secret } = await body<{ secret: string }>(await setupRoute.POST(post("/api/account/2fa/setup", undefined, u.token), undefined));
    const key = base32Decode(secret);
    expect((await enableRoute.POST(post("/api/account/2fa/enable", { code: hotp(key, counterAt(Date.now())) }, u.token), undefined)).status).toBe(200);
    expect(await errorCode(await request(u.token, { newEmail: fresh(), password: u.password }))).toBe("mfa_required");
    expect(await errorCode(await request(u.token, { newEmail: fresh(), password: u.password, code: "000000" }))).toBe("mfa_invalid_code");
    expect((await request(u.token, { newEmail: fresh(), password: u.password, code: hotp(key, counterAt(Date.now()) + 1) })).status).toBe(200);
  });

  it("annulation depuis l'ancienne adresse : adresse rétablie, sessions fermées, 2FA retirée, lien de réinitialisation", async () => {
    const u = await signUp(app);
    // Scénario d'intrusion : l'intrus active SA double authentification puis change l'adresse.
    const { secret } = await body<{ secret: string }>(await setupRoute.POST(post("/api/account/2fa/setup", undefined, u.token), undefined));
    const key = base32Decode(secret);
    await enableRoute.POST(post("/api/account/2fa/enable", { code: hotp(key, counterAt(Date.now())) }, u.token), undefined);
    const intruder = fresh();
    await request(u.token, { newEmail: intruder, password: u.password, code: hotp(key, counterAt(Date.now()) + 1) });
    await confirm(tokenFromEmail(memoryEmail.lastTo(intruder)));
    const revertToken = tokenFromEmail(memoryEmail.lastTo(u.email));

    const res = await revert(revertToken);
    expect(res.status).toBe(200);
    const row = await userRow(u.userId);
    expect(row).toMatchObject({ email: u.email, previousEmail: null, pendingEmail: null, totpEnabledAt: null, totpSecretEnc: null });
    expect((await me(u.token)).status).toBe(401);
    const reset = memoryEmail.lastTo(u.email);
    expect(reset?.tag).toBe("reset_password");
    const r = await resetRoute.POST(post("/api/auth/password/reset", { token: tokenFromEmail(reset), password: "Phrase-Reprise-En-Main-7" }), undefined);
    expect(await body(r)).toMatchObject({ ok: true, loginRequired: false });
    expect((await login(intruder, "Phrase-Reprise-En-Main-7")).status).toBe(401);
    // Lien d'annulation à usage unique
    expect((await revert(revertToken)).status).toBe(400);
  });

  it("liens invalides, expirés ou d'un autre usage refusés", async () => {
    const u = await signUp(app);
    const newEmail = fresh();
    await request(u.token, { newEmail, password: u.password });
    const token = tokenFromEmail(memoryEmail.lastTo(newEmail));
    expect((await revert(token)).status).toBe(400); // jeton de confirmation ≠ jeton d'annulation
    for (const bad of ["", "court", "x".repeat(500)]) expect((await confirm(bad)).status).toBe(400);
    await app.db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.userId, u.userId));
    expect((await confirm(token)).status).toBe(400);
  });

  it("la purge efface les adresses en attente ou précédentes dont le lien a expiré, pas les autres", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await request(a.token, { newEmail: fresh(), password: a.password });
    await request(b.token, { newEmail: fresh(), password: b.password });
    await app.db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.userId, a.userId));
    const report = await runPurge(app.db, { apply: true });
    expect(report.staleEmailChanges).toBeGreaterThanOrEqual(1);
    expect((await userRow(a.userId)).pendingEmail).toBeNull();
    expect((await userRow(b.userId)).pendingEmail).not.toBeNull();
  });

  it("abonné Stripe : l'adresse du client Stripe est mise à jour ; un échec Stripe ne bloque pas", async () => {
    const env = {
      STRIPE_SECRET_KEY: "sk_" + "test_" + "z".repeat(24),
      STRIPE_WEBHOOK_SECRET: "whsec_" + "z".repeat(24),
      STRIPE_PRICE_ESSENTIEL_MONTHLY: "price_ess_m",
      STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
    };
    Object.assign(process.env, env);
    resetConfigForTests();
    const calls: { url: string; body: string }[] = [];
    try {
      setStripeFetchForTests(async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ error: { type: "api_error" } }), { status: 500 });
      });
      const u = await signUp(app);
      await app.db.update(users).set({ billingCustomerId: "cus_123" }).where(eq(users.id, u.userId));
      const newEmail = fresh();
      await request(u.token, { newEmail, password: u.password });
      expect((await confirm(tokenFromEmail(memoryEmail.lastTo(newEmail)))).status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/customers/cus_123");
      expect(decodeURIComponent(calls[0]!.body)).toContain(`email=${newEmail}`);
    } finally {
      setStripeFetchForTests(null);
      for (const k of Object.keys(env)) delete process.env[k];
      resetConfigForTests();
    }
  });

  it("masquage des adresses", () => {
    expect(maskEmail("marie@exemple.fr")).toBe("m•••e@exemple.fr");
    expect(maskEmail("jo@exemple.fr")).toBe("j•••@exemple.fr");
  });
});
