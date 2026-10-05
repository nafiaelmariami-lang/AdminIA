import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as registerRoute from "@/app/api/auth/register/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as verifyRoute from "@/app/api/auth/verify-email/route";
import * as resendRoute from "@/app/api/auth/verify-email/resend/route";
import * as forgotRoute from "@/app/api/auth/password/forgot/route";
import * as resetRoute from "@/app/api/auth/password/reset/route";
import * as changeRoute from "@/app/api/account/password/route";
import * as analyzeRoute from "@/app/api/documents/[id]/analyze/route";
import { authTokens, users } from "@/server/db/schema";
import { BrevoEmailSender, EmailError } from "@/server/email";
import { emails } from "@/server/email/templates";
import { TERMS_VERSION } from "@/lib/legal";
import { apiRequest, ctx, memoryEmail, setupTestApp, signUp, tokenFrom, tokenFromEmail, uploadOk, type TestApp } from "./helpers";
import { makePdf, URSSAF_LETTER } from "./fixtures";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());
beforeEach(() => {
  memoryEmail.fail = false;
});

const post = (path: string, json: unknown, token?: string) => apiRequest(path, { method: "POST", json, token });
const me = (token: string) => meRoute.GET(apiRequest("/api/auth/me", { token }), undefined);
const login = (email: string, password: string) => loginRoute.POST(post("/api/auth/login", { email, password }), undefined);

describe("confirmation de l'adresse e-mail", () => {
  it("l'inscription envoie un lien et enregistre la preuve du consentement", async () => {
    const u = await signUp(app, { verified: false });
    const mail = memoryEmail.lastTo(u.email);
    expect(mail?.tag).toBe("verify_email");
    expect(mail?.html).toContain("/verifier-email?token=");
    const [row] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(row!.termsVersion).toBe(TERMS_VERSION);
    expect(row!.termsAcceptedAt).toBeInstanceOf(Date);
    expect(row!.emailVerifiedAt).toBeNull();
  });

  it("sans confirmation : l'ajout est possible, l'analyse IA est bloquée ; après confirmation elle fonctionne", async () => {
    const u = await signUp(app, { verified: false });
    const doc = await uploadOk(u.token, "c.pdf", makePdf([URSSAF_LETTER]));
    const blocked = await analyzeRoute.POST(post(`/api/documents/${doc.id}/analyze`, undefined, u.token), ctx(doc.id));
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("email_not_verified");

    const token = tokenFromEmail(memoryEmail.lastTo(u.email));
    expect((await verifyRoute.POST(post("/api/auth/verify-email", { token }), undefined)).status).toBe(200);
    expect(((await (await me(u.token)).json()) as { user: { emailVerified: boolean } }).user.emailVerified).toBe(true);
    expect((await analyzeRoute.POST(post(`/api/documents/${doc.id}/analyze`, undefined, u.token), ctx(doc.id))).status).toBe(200);
    // Lien à usage unique
    expect((await verifyRoute.POST(post("/api/auth/verify-email", { token }), undefined)).status).toBe(400);
  });

  it("refuse les jetons invalides, expirés ou d'un autre usage", async () => {
    const u = await signUp(app, { verified: false });
    const token = tokenFromEmail(memoryEmail.lastTo(u.email));
    for (const bad of ["", "court", "x".repeat(500), "A".repeat(43), null, 123]) {
      expect((await verifyRoute.POST(post("/api/auth/verify-email", { token: bad }), undefined)).status).toBe(400);
    }
    // Un jeton de confirmation ne permet pas de réinitialiser le mot de passe
    expect((await resetRoute.POST(post("/api/auth/password/reset", { token, password: "Nouveau-Mot-De-Passe-99" }), undefined)).status).toBe(400);
    await app.db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.userId, u.userId));
    expect((await verifyRoute.POST(post("/api/auth/verify-email", { token }), undefined)).status).toBe(400);
  });

  it("renvoi du lien : limité, refusé si déjà confirmée, invalide l'ancien lien", async () => {
    const u = await signUp(app, { verified: false });
    const first = tokenFromEmail(memoryEmail.lastTo(u.email));
    expect((await resendRoute.POST(post("/api/auth/verify-email/resend", {}, u.token), undefined)).status).toBe(200);
    const second = tokenFromEmail(memoryEmail.lastTo(u.email));
    expect(second).not.toBe(first);
    expect((await verifyRoute.POST(post("/api/auth/verify-email", { token: first }), undefined)).status).toBe(400);
    await resendRoute.POST(post("/api/auth/verify-email/resend", {}, u.token), undefined);
    await resendRoute.POST(post("/api/auth/verify-email/resend", {}, u.token), undefined);
    expect((await resendRoute.POST(post("/api/auth/verify-email/resend", {}, u.token), undefined)).status).toBe(429);
    const v = await signUp(app);
    expect((await resendRoute.POST(post("/api/auth/verify-email/resend", {}, v.token), undefined)).status).toBe(400);
    expect((await resendRoute.POST(post("/api/auth/verify-email/resend", {}), undefined)).status).toBe(401);
  });

  it("une panne du service d'e-mail ne bloque pas l'inscription", async () => {
    memoryEmail.fail = true;
    const res = await registerRoute.POST(
      post("/api/auth/register", { email: "panne@exemple.fr", password: "Une-Phrase-Solide-42", name: "P", acceptTerms: true }),
      undefined,
    );
    expect(res.status).toBe(201);
  });
});

describe("mot de passe oublié et réinitialisation", () => {
  it("réponse identique pour un compte existant ou inconnu ; e-mail seulement s'il existe", async () => {
    const u = await signUp(app);
    const before = memoryEmail.sent.length;
    const a = await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined);
    const b = await forgotRoute.POST(post("/api/auth/password/forgot", { email: "inconnu-xyz@exemple.fr" }), undefined);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect(memoryEmail.sent.length).toBe(before + 1);
    expect(memoryEmail.lastTo(u.email)?.tag).toBe("reset_password");
  });

  it("réinitialise, ferme toutes les sessions, ouvre une nouvelle session, prévient par e-mail", async () => {
    const u = await signUp(app);
    const other = tokenFrom(await login(u.email, u.password))!;
    await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined);
    const token = tokenFromEmail(memoryEmail.lastTo(u.email));

    // Mot de passe trop faible : refusé, et le lien reste utilisable
    expect((await resetRoute.POST(post("/api/auth/password/reset", { token, password: "court" }), undefined)).status).toBe(400);
    const res = await resetRoute.POST(post("/api/auth/password/reset", { token, password: "Nouvelle-Phrase-Secrete-7" }), undefined);
    expect(res.status).toBe(200);
    const fresh = tokenFrom(res)!;
    expect((await me(fresh)).status).toBe(200);
    expect((await me(u.token)).status).toBe(401);
    expect((await me(other)).status).toBe(401);
    expect((await login(u.email, u.password)).status).toBe(401);
    expect((await login(u.email, "Nouvelle-Phrase-Secrete-7")).status).toBe(200);
    expect(memoryEmail.lastTo(u.email)?.tag).toBe("password_changed");
    // Jeton déjà utilisé
    expect((await resetRoute.POST(post("/api/auth/password/reset", { token, password: "Encore-Une-Autre-Phrase-8" }), undefined)).status).toBe(400);
  });

  it("une réinitialisation confirme aussi l'adresse e-mail (preuve d'accès à la boîte)", async () => {
    const u = await signUp(app, { verified: false });
    await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined);
    const token = tokenFromEmail(memoryEmail.lastTo(u.email));
    await resetRoute.POST(post("/api/auth/password/reset", { token, password: "Nouvelle-Phrase-Secrete-7" }), undefined);
    const [row] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(row!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("deux utilisations simultanées du même lien : une seule réussit", async () => {
    const u = await signUp(app);
    await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined);
    const token = tokenFromEmail(memoryEmail.lastTo(u.email));
    const results = await Promise.all(
      ["Premiere-Phrase-Secrete-1", "Seconde-Phrase-Secrete-2", "Troisieme-Phrase-Secrete-3"].map((password) =>
        resetRoute.POST(post("/api/auth/password/reset", { token, password }), undefined),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
  });

  it("limite les demandes répétées", async () => {
    const u = await signUp(app);
    for (let i = 0; i < 3; i++) await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined);
    expect((await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined)).status).toBe(429);
  });
});

describe("changement de mot de passe depuis l'espace", () => {
  it("exige l'ancien mot de passe, refuse un mot de passe faible ou identique, déconnecte les autres appareils", async () => {
    const u = await signUp(app);
    const other = tokenFrom(await login(u.email, u.password))!;
    const change = (json: unknown) => changeRoute.POST(post("/api/account/password", json, u.token), undefined);
    expect((await change({ currentPassword: "faux-mot-de-passe", newPassword: "Nouvelle-Phrase-Secrete-7" })).status).toBe(401);
    expect((await change({ currentPassword: u.password, newPassword: u.password })).status).toBe(400);
    expect((await change({ currentPassword: u.password, newPassword: "azertyuiop" })).status).toBe(400);
    expect((await change({ currentPassword: u.password, newPassword: "Nouvelle-Phrase-Secrete-7" })).status).toBe(200);
    expect((await me(u.token)).status).toBe(200); // l'appareil courant reste connecté
    expect((await me(other)).status).toBe(401);
    expect(memoryEmail.lastTo(u.email)?.tag).toBe("password_changed");
    expect((await login(u.email, "Nouvelle-Phrase-Secrete-7")).status).toBe(200);
  });

  it("exige une session", async () => {
    expect((await changeRoute.POST(post("/api/account/password", { currentPassword: "a", newPassword: "b" }), undefined)).status).toBe(401);
  });
});

describe("fournisseur d'e-mail et gabarits", () => {
  it("Brevo : requête conforme, clé dans l'en-tête, erreurs typées", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = new BrevoEmailSender("cle-test", { email: "contact@adminia.fr", name: "AdminIA" }, async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response("{}", { status: 201 });
    });
    await sender.send(emails.resetPassword("a@exemple.fr", "https://adminia.fr/r?token=x"));
    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(new Headers(calls[0]!.init.headers).get("api-key")).toBe("cle-test");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.to).toEqual([{ email: "a@exemple.fr" }]);
    expect(body.sender.email).toBe("contact@adminia.fr");

    const failing = new BrevoEmailSender("k", { email: "a@b.fr", name: "x" }, async () => new Response("{}", { status: 401 }));
    await expect(failing.send(emails.resetPassword("a@b.fr", "u"))).rejects.toBeInstanceOf(EmailError);
    const down = new BrevoEmailSender("k", { email: "a@b.fr", name: "x" }, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(down.send(emails.resetPassword("a@b.fr", "u"))).rejects.toBeInstanceOf(EmailError);
  });

  it("les gabarits échappent le HTML (nom saisi par l'utilisateur)", () => {
    const m = emails.verifyEmail("a@b.fr", '<script>alert(1)</script>"', "https://adminia.fr/v?token=abc&x=1");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("token=abc&amp;x=1");
    expect(m.text).toContain("https://adminia.fr/v?token=abc&x=1");
  });
});
