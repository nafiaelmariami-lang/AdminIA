import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as register from "@/app/api/auth/register/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/auth/me/route";
import { sessions, users } from "@/server/db/schema";
import { apiRequest, setupTestApp, signUp, tokenFrom, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());

const reg = (json: unknown, origin?: string) => register.POST(apiRequest("/api/auth/register", { method: "POST", json, origin }), undefined);
const log = (json: unknown) => login.POST(apiRequest("/api/auth/login", { method: "POST", json }), undefined);

describe("inscription", () => {
  it("crée le compte, ouvre une session et pose un cookie httpOnly SameSite", async () => {
    const res = await reg({ email: "  Alice@Exemple.FR ", password: "Correct-Horse-Battery-9", name: "Alice", acceptTerms: true });
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const [u] = await app.db.select().from(users).where(eq(users.email, "alice@exemple.fr"));
    expect(u).toBeDefined();
    expect(u!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u!.passwordHash).not.toContain("Correct-Horse");
    expect(u!.plan).toBe("free");
  });

  it("stocke uniquement le haché du jeton de session", async () => {
    const res = await reg({ email: "hash@exemple.fr", password: "Correct-Horse-Battery-9", name: "H", acceptTerms: true });
    const token = tokenFrom(res)!;
    const rows = await app.db.select().from(sessions);
    expect(rows.some((s) => s.id === token)).toBe(false);
    expect(rows.every((s) => /^[0-9a-f]{64}$/.test(s.id))).toBe(true);
  });

  it("refuse les adresses e-mail invalides, mots de passe faibles et CGU non acceptées", async () => {
    expect((await reg({ email: "pas-un-email", password: "Correct-Horse-Battery-9", name: "X", acceptTerms: true })).status).toBe(400);
    expect((await reg({ email: "x@exemple.fr", password: "court", name: "X", acceptTerms: true })).status).toBe(400);
    expect((await reg({ email: "x@exemple.fr", password: "azertyuiop", name: "X", acceptTerms: true })).status).toBe(400);
    expect((await reg({ email: "x@exemple.fr", password: "Correct-Horse-Battery-9", name: "X", acceptTerms: false })).status).toBe(400);
    expect((await reg({ email: "x@exemple.fr", password: "Correct-Horse-Battery-9", name: "X" })).status).toBe(400);
  });

  it("refuse un e-mail déjà utilisé (insensible à la casse)", async () => {
    await reg({ email: "bob@exemple.fr", password: "Correct-Horse-Battery-9", name: "Bob", acceptTerms: true });
    const res = await reg({ email: "BOB@exemple.fr", password: "Correct-Horse-Battery-9", name: "Bob", acceptTerms: true });
    expect(res.status).toBe(409);
  });

  it("refuse un JSON invalide sans planter", async () => {
    const req = new Request("http://localhost:3000/api/auth/register", { method: "POST", body: "{pas du json", headers: { origin: "http://localhost:3000" } });
    expect((await register.POST(req, undefined)).status).toBe(400);
  });
});

describe("connexion", () => {
  it("connecte avec les bons identifiants", async () => {
    const u = await signUp(app);
    const res = await log({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const token = tokenFrom(res)!;
    const meRes = await me.GET(apiRequest("/api/auth/me", { token }), undefined);
    expect(meRes.status).toBe(200);
    expect(((await meRes.json()) as { user: { email: string } }).user.email).toBe(u.email);
  });

  it("renvoie le même message pour un compte inconnu et un mauvais mot de passe", async () => {
    const u = await signUp(app);
    const wrong = await log({ email: u.email, password: "Mauvais-Mot-De-Passe-1" });
    const unknown = await log({ email: "inconnu@exemple.fr", password: "Mauvais-Mot-De-Passe-1" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("bloque après 10 tentatives (force brute)", async () => {
    const u = await signUp(app);
    for (let i = 0; i < 10; i++) expect((await log({ email: u.email, password: "Faux-Mot-De-Passe-" + i })).status).toBe(401);
    const blocked = await log({ email: u.email, password: u.password });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});

describe("sessions et accès non autorisé", () => {
  it("refuse l'accès sans cookie, avec un jeton inventé ou trop long", async () => {
    expect((await me.GET(apiRequest("/api/auth/me"), undefined)).status).toBe(401);
    expect((await me.GET(apiRequest("/api/auth/me", { token: "jeton-invente" }), undefined)).status).toBe(401);
    expect((await me.GET(apiRequest("/api/auth/me", { token: "a".repeat(5000) }), undefined)).status).toBe(401);
  });

  it("la déconnexion invalide la session côté serveur", async () => {
    const u = await signUp(app);
    const res = await logout.POST(apiRequest("/api/auth/logout", { method: "POST", token: u.token }), undefined);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await me.GET(apiRequest("/api/auth/me", { token: u.token }), undefined)).status).toBe(401);
  });

  it("une session expirée est refusée et supprimée", async () => {
    const u = await signUp(app);
    await app.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, u.userId));
    expect((await me.GET(apiRequest("/api/auth/me", { token: u.token }), undefined)).status).toBe(401);
    expect(await app.db.select().from(sessions).where(eq(sessions.userId, u.userId))).toHaveLength(0);
  });

  it("refuse les requêtes d'écriture venant d'une autre origine (CSRF)", async () => {
    const res = await reg({ email: "csrf@exemple.fr", password: "Correct-Horse-Battery-9", name: "C", acceptTerms: true }, "https://site-malveillant.example");
    expect(res.status).toBe(403);
    const req = new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { "sec-fetch-site": "cross-site" } });
    expect((await logout.POST(req, undefined)).status).toBe(403);
  });
});
