import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as loginRoute from "@/app/api/auth/login/route";
import * as mfaRoute from "@/app/api/auth/mfa/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as forgotRoute from "@/app/api/auth/password/forgot/route";
import * as resetRoute from "@/app/api/auth/password/reset/route";
import * as statusRoute from "@/app/api/account/2fa/route";
import * as setupRoute from "@/app/api/account/2fa/setup/route";
import * as enableRoute from "@/app/api/account/2fa/enable/route";
import * as disableRoute from "@/app/api/account/2fa/disable/route";
import * as recoveryRoute from "@/app/api/account/2fa/recovery-codes/route";
import { mfaChallenges, recoveryCodes, users } from "@/server/db/schema";
import { base32Decode, base32Encode, counterAt, hotp, newRecoveryCodes, openSecret, otpauthUri, sealSecret, verifyTotp } from "@/server/auth/totp";
import { runPurge } from "@/server/maintenance";
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
const call = (handler: (req: Request, ctx: undefined) => Promise<Response>, path: string, json: unknown, token?: string) => handler(post(path, json, token), undefined);
const body = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const errorCode = async (res: Response) => (await body<{ error: { code: string } }>(res)).error.code;
const me = (token: string) => meRoute.GET(apiRequest("/api/auth/me", { token }), undefined);
const codeAt = (secret: Buffer, offset = 0) => hotp(secret, counterAt(Date.now()) + offset);

/** Compte avec double authentification activée ; renvoie le secret et les codes de secours. */
async function enrolled() {
  const u = await signUp(app);
  const setup = await body<{ secret: string; uri: string; qrSvg: string }>(await call(setupRoute.POST, "/api/account/2fa/setup", undefined, u.token));
  const secret = base32Decode(setup.secret);
  const res = await call(enableRoute.POST, "/api/account/2fa/enable", { code: codeAt(secret) }, u.token);
  expect(res.status).toBe(200);
  const { recoveryCodes: codes } = await body<{ recoveryCodes: string[] }>(res);
  return { ...u, secret, codes, setup };
}
/** Autorise un nouveau code dans la même période de 30 s (les tests vont plus vite que l'horloge). */
const resetReplayGuard = (userId: string) => app.db.update(users).set({ totpLastCounter: null }).where(eq(users.id, userId));

describe("TOTP (RFC 4226 / RFC 6238)", () => {
  const rfcSecret = Buffer.from("12345678901234567890");

  it("respecte les vecteurs de test officiels", () => {
    // RFC 4226, annexe D
    expect(["755224", "287082", "359152", "969429", "338314"].map((_, i) => hotp(rfcSecret, i))).toEqual(["755224", "287082", "359152", "969429", "338314"]);
    // RFC 6238, annexe B (8 chiffres)
    expect(hotp(rfcSecret, counterAt(59_000), 8)).toBe("94287082");
    expect(hotp(rfcSecret, counterAt(1_111_111_109_000), 8)).toBe("07081804");
    expect(hotp(rfcSecret, counterAt(20_000_000_000_000), 8)).toBe("65353130");
    expect(hotp(Buffer.from("12345678901234567890123456789012"), counterAt(59_000), 8, "sha256")).toBe("46119246");
    expect(hotp(Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"), counterAt(59_000), 8, "sha512")).toBe("90693936");
  });

  it("base32 aller-retour, tolère espaces et minuscules", () => {
    const s = Buffer.from("12345678901234567890");
    expect(base32Encode(s)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").equals(s)).toBe(true);
  });

  it("fenêtre de ±1 période, refus des compteurs déjà utilisés et des formats invalides", () => {
    const now = 1_700_000_000_000;
    const c = counterAt(now);
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, c), { now })).toBe(c);
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, c - 1), { now })).toBe(c - 1);
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, c + 1), { now })).toBe(c + 1);
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, c - 2), { now })).toBeNull();
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, c + 2), { now })).toBeNull();
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, c), { now, lastCounter: c })).toBeNull();
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, c + 1), { now, lastCounter: c })).toBe(c + 1);
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", "١٢٣٤٥٦"]) expect(verifyTotp(rfcSecret, bad, { now })).toBeNull();
  });

  it("secret chiffré et lié au compte ; URI otpauth standard ; codes de secours uniques", () => {
    const secret = Buffer.from("abcdefghijabcdefghij");
    const sealed = sealSecret("user-a", secret);
    expect(sealed).not.toContain(base32Encode(secret));
    expect(openSecret("user-a", sealed).equals(secret)).toBe(true);
    expect(() => openSecret("user-b", sealed)).toThrow();
    const uri = otpauthUri(secret, "marie+test@exemple.fr");
    expect(uri).toMatch(/^otpauth:\/\/totp\/AdminIA(:|%3A)marie%2Btest%40exemple\.fr\?/);
    expect(uri).toContain(`secret=${base32Encode(secret)}`);
    expect(uri).toContain("issuer=AdminIA");
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });
});

describe("activation de la double authentification", () => {
  it("parcours complet : QR code, code faux refusé, activation, codes de secours, e-mail, statut", async () => {
    const u = await signUp(app);
    expect(await body(await statusRoute.GET(apiRequest("/api/account/2fa", { token: u.token }), undefined))).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
    const setupRes = await call(setupRoute.POST, "/api/account/2fa/setup", undefined, u.token);
    expect(setupRes.headers.get("cache-control")).toBe("no-store");
    const setup = await body<{ secret: string; uri: string; qrSvg: string }>(setupRes);
    expect(setup.qrSvg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    expect(setup.qrSvg).not.toMatch(/<script|on\w+=/i);
    const secret = base32Decode(setup.secret);

    // Rien n'est actif avant la saisie d'un code valide.
    const [pending] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(pending!.totpEnabledAt).toBeNull();
    expect(pending!.totpPendingSecretEnc).toBeTruthy();
    expect(pending!.totpPendingSecretEnc).not.toContain(setup.secret);

    const wrong = String((Number(codeAt(secret)) + 1) % 1_000_000).padStart(6, "0");
    const bad = await call(enableRoute.POST, "/api/account/2fa/enable", { code: wrong === codeAt(secret, 1) ? "000000" : wrong }, u.token);
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe("mfa_invalid_code");

    const ok = await call(enableRoute.POST, "/api/account/2fa/enable", { code: codeAt(secret) }, u.token);
    expect(ok.status).toBe(200);
    const { recoveryCodes: codes } = await body<{ recoveryCodes: string[] }>(ok);
    expect(codes).toHaveLength(10);
    expect(memoryEmail.lastTo(u.email)?.tag).toBe("mfa_enabled");

    const [row] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(row!.totpEnabledAt).toBeInstanceOf(Date);
    expect(row!.totpPendingSecretEnc).toBeNull();
    // Codes de secours stockés hachés uniquement.
    const stored = await app.db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, u.userId));
    expect(stored).toHaveLength(10);
    for (const c of codes) expect(JSON.stringify(stored)).not.toContain(c.replace("-", ""));
    expect(await body(await statusRoute.GET(apiRequest("/api/account/2fa", { token: u.token }), undefined))).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

    // Déjà activée : pas de nouveau QR code.
    expect(await errorCode(await call(setupRoute.POST, "/api/account/2fa/setup", undefined, u.token))).toBe("mfa_already_enabled");
  });

  it("l'activation sans QR code préalable est refusée ; les routes exigent une session", async () => {
    const u = await signUp(app);
    expect(await errorCode(await call(enableRoute.POST, "/api/account/2fa/enable", { code: "123456" }, u.token))).toBe("mfa_no_setup");
    for (const [h, p] of [
      [setupRoute.POST, "/api/account/2fa/setup"],
      [enableRoute.POST, "/api/account/2fa/enable"],
      [disableRoute.POST, "/api/account/2fa/disable"],
      [recoveryRoute.POST, "/api/account/2fa/recovery-codes"],
    ] as const) {
      expect((await call(h, p, { code: "123456", password: "x" })).status).toBe(401);
    }
  });

  it("l'activation ferme les autres sessions, pas celle en cours", async () => {
    const u = await signUp(app);
    const other = tokenFrom(await loginRoute.POST(post("/api/auth/login", { email: u.email, password: u.password }), undefined))!;
    expect((await me(other)).status).toBe(200);
    const setup = await body<{ secret: string }>(await call(setupRoute.POST, "/api/account/2fa/setup", undefined, u.token));
    expect((await call(enableRoute.POST, "/api/account/2fa/enable", { code: codeAt(base32Decode(setup.secret)) }, u.token)).status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await me(u.token)).status).toBe(200);
  });
});

describe("connexion en deux étapes", () => {
  const login = (email: string, password: string) => loginRoute.POST(post("/api/auth/login", { email, password }), undefined);
  const complete = (challenge: string, code: string) => mfaRoute.POST(post("/api/auth/mfa", { challenge, code }), undefined);

  it("le mot de passe seul ne donne aucune session ; le code de l'application oui", async () => {
    const u = await enrolled();
    const step1 = await login(u.email, u.password);
    expect(step1.status).toBe(200);
    expect(tokenFrom(step1)).toBeNull();
    const { mfaRequired, challenge } = await body<{ mfaRequired: boolean; challenge: string }>(step1);
    expect(mfaRequired).toBe(true);
    expect(challenge.length).toBeGreaterThan(20);

    const step2 = await complete(challenge, codeAt(u.secret, 1));
    expect(step2.status).toBe(200);
    const session = tokenFrom(step2);
    expect(session).toBeTruthy();
    expect((await me(session!)).status).toBe(200);
    // L'étape intermédiaire est à usage unique.
    expect(await errorCode(await complete(challenge, codeAt(u.secret, 1)))).toBe("mfa_expired");
  });

  it("un mauvais mot de passe ne révèle pas que la double authentification est active", async () => {
    const u = await enrolled();
    const res = await login(u.email, "Mauvais-Mot-De-Passe-1");
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("invalid_credentials");
  });

  it("un code déjà utilisé ne peut pas resservir (rejeu)", async () => {
    const u = await enrolled();
    const code = codeAt(u.secret, 1);
    const a = await body<{ challenge: string }>(await login(u.email, u.password));
    expect((await complete(a.challenge, code)).status).toBe(200);
    const b = await body<{ challenge: string }>(await login(u.email, u.password));
    expect(await errorCode(await complete(b.challenge, code))).toBe("mfa_invalid_code");
    // Le code utilisé à l'activation non plus.
    const c = await body<{ challenge: string }>(await login(u.email, u.password));
    expect(await errorCode(await complete(c.challenge, codeAt(u.secret)))).toBe("mfa_invalid_code");
  });

  it("deux validations simultanées du même code : une seule réussit", async () => {
    const u = await enrolled();
    const code = codeAt(u.secret, 1);
    const [a, b] = await Promise.all([login(u.email, u.password), login(u.email, u.password)].map(async (p) => (await body<{ challenge: string }>(await p)).challenge));
    const results = await Promise.all([complete(a!, code), complete(b!, code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("code de secours : usage unique, insensible à la casse et aux tirets", async () => {
    const u = await enrolled();
    const rc = u.codes[0]!;
    const a = await body<{ challenge: string }>(await login(u.email, u.password));
    const ok = await complete(a.challenge, ` ${rc.toLowerCase().replace("-", " ")} `);
    expect(ok.status).toBe(200);
    expect(tokenFrom(ok)).toBeTruthy();
    const b = await body<{ challenge: string }>(await login(u.email, u.password));
    expect(await errorCode(await complete(b.challenge, rc))).toBe("mfa_invalid_code");
    expect(await body(await statusRoute.GET(apiRequest("/api/account/2fa", { token: tokenFrom(ok)! }), undefined))).toMatchObject({ recoveryCodesLeft: 9 });
  });

  it("5 essais au plus par étape, puis il faut ressaisir le mot de passe ; étape expirée refusée", async () => {
    const u = await enrolled();
    const { challenge } = await body<{ challenge: string }>(await login(u.email, u.password));
    for (let i = 0; i < 5; i++) expect(await errorCode(await complete(challenge, "000000"))).toBe("mfa_invalid_code");
    // Même le bon code est refusé : l'étape est épuisée.
    expect(await errorCode(await complete(challenge, codeAt(u.secret, 1)))).toBe("mfa_expired");

    const fresh = await body<{ challenge: string }>(await login(u.email, u.password));
    await app.db.update(mfaChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(mfaChallenges.userId, u.userId));
    expect(await errorCode(await complete(fresh.challenge, codeAt(u.secret, 1)))).toBe("mfa_expired");
  });

  it("entrées invalides refusées proprement", async () => {
    for (const payload of [{}, { challenge: "x", code: "123456" }, { challenge: "a".repeat(43), code: 123456 }, { challenge: "a".repeat(43), code: "1".repeat(100) }]) {
      const res = await mfaRoute.POST(post("/api/auth/mfa", payload), undefined);
      expect([400, 401]).toContain(res.status);
    }
    expect(await errorCode(await complete("a".repeat(43), "123456"))).toBe("mfa_expired");
  });

  it("la purge supprime les étapes de connexion expirées", async () => {
    const u = await enrolled();
    await login(u.email, u.password);
    await app.db.update(mfaChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(mfaChallenges.userId, u.userId));
    const report = await runPurge(app.db, { apply: true });
    expect(report.expiredMfaChallenges).toBeGreaterThanOrEqual(1);
    expect(await app.db.select().from(mfaChallenges).where(eq(mfaChallenges.userId, u.userId))).toHaveLength(0);
  });
});

describe("gestion depuis l'espace connecté", () => {
  it("désactivation : mot de passe ET code exigés ; ensuite la connexion redevient directe", async () => {
    const u = await enrolled();
    await resetReplayGuard(u.userId);
    expect((await call(disableRoute.POST, "/api/account/2fa/disable", { password: "Mauvais-Mot-De-Passe-1", code: codeAt(u.secret) }, u.token)).status).toBe(401);
    expect(await errorCode(await call(disableRoute.POST, "/api/account/2fa/disable", { password: u.password, code: "000000" }, u.token))).toBe("mfa_invalid_code");
    expect((await call(disableRoute.POST, "/api/account/2fa/disable", { password: u.password }, u.token)).status).toBe(400);
    const ok = await call(disableRoute.POST, "/api/account/2fa/disable", { password: u.password, code: codeAt(u.secret) }, u.token);
    expect(ok.status).toBe(200);
    expect(memoryEmail.lastTo(u.email)?.tag).toBe("mfa_disabled");
    const [row] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(row!.totpSecretEnc).toBeNull();
    expect(row!.totpEnabledAt).toBeNull();
    expect(await app.db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, u.userId))).toHaveLength(0);
    expect(tokenFrom(await loginRoute.POST(post("/api/auth/login", { email: u.email, password: u.password }), undefined))).toBeTruthy();
  });

  it("nouveaux codes de secours : les anciens deviennent inutilisables", async () => {
    const u = await enrolled();
    const res = await call(recoveryRoute.POST, "/api/account/2fa/recovery-codes", { password: u.password, code: u.codes[0] }, u.token);
    expect(res.status).toBe(200);
    const { recoveryCodes: fresh } = await body<{ recoveryCodes: string[] }>(res);
    expect(fresh).toHaveLength(10);
    const { challenge } = await body<{ challenge: string }>(await loginRoute.POST(post("/api/auth/login", { email: u.email, password: u.password }), undefined));
    expect(await errorCode(await mfaRoute.POST(post("/api/auth/mfa", { challenge, code: u.codes[1] }), undefined))).toBe("mfa_invalid_code");
    expect((await mfaRoute.POST(post("/api/auth/mfa", { challenge, code: fresh[0] }), undefined)).status).toBe(200);
  });

  it("isolation : le code d'un compte ne vaut rien pour un autre", async () => {
    const a = await enrolled();
    const b = await enrolled();
    const { challenge } = await body<{ challenge: string }>(await loginRoute.POST(post("/api/auth/login", { email: b.email, password: b.password }), undefined));
    expect(await errorCode(await mfaRoute.POST(post("/api/auth/mfa", { challenge, code: a.codes[0] }), undefined))).toBe("mfa_invalid_code");
    expect(await errorCode(await mfaRoute.POST(post("/api/auth/mfa", { challenge, code: codeAt(a.secret, 1) === codeAt(b.secret, 1) ? "000000" : codeAt(a.secret, 1) }), undefined))).toBe("mfa_invalid_code");
  });
});

describe("mot de passe oublié avec double authentification", () => {
  it("la réinitialisation n'ouvre pas de session : le second facteur reste exigé", async () => {
    const u = await enrolled();
    expect((await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined)).status).toBe(200);
    const token = tokenFromEmail(memoryEmail.lastTo(u.email));
    const res = await resetRoute.POST(post("/api/auth/password/reset", { token, password: "Nouveau-Mot-De-Passe-99" }), undefined);
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ ok: true, loginRequired: true });
    expect(tokenFrom(res)).toBeNull();
    // Les sessions existantes sont fermées, et la connexion demande toujours le code.
    expect((await me(u.token)).status).toBe(401);
    const login = await loginRoute.POST(post("/api/auth/login", { email: u.email, password: "Nouveau-Mot-De-Passe-99" }), undefined);
    expect(await body(login)).toMatchObject({ mfaRequired: true });
  });

  it("sans double authentification, la réinitialisation ouvre directement une session (inchangé)", async () => {
    const u = await signUp(app);
    await forgotRoute.POST(post("/api/auth/password/forgot", { email: u.email }), undefined);
    const token = tokenFromEmail(memoryEmail.lastTo(u.email));
    const res = await resetRoute.POST(post("/api/auth/password/reset", { token, password: "Nouveau-Mot-De-Passe-99" }), undefined);
    expect(await body(res)).toMatchObject({ ok: true, loginRequired: false });
    expect(tokenFrom(res)).toBeTruthy();
  });
});
