import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as overviewRoute from "@/app/api/admin/overview/route";
import * as usersRoute from "@/app/api/admin/users/route";
import * as planRoute from "@/app/api/admin/users/[id]/plan/route";
import * as settingsRoute from "@/app/api/admin/settings/route";
import * as auditRoute from "@/app/api/admin/audit/route";
import * as setupRoute from "@/app/api/account/2fa/setup/route";
import * as enableRoute from "@/app/api/account/2fa/enable/route";
import * as analyzeRoute from "@/app/api/documents/[id]/analyze/route";
import { activityLog, adminAudit, users } from "@/server/db/schema";
import { resetConfigForTests } from "@/server/config";
import { setSetting } from "@/server/settings";
import { isAdminEmail } from "@/server/admin/access";
import { runPurge } from "@/server/maintenance";
import { base32Decode, counterAt, hotp } from "@/server/auth/totp";
import { apiRequest, ctx, setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";
import { makePdf } from "./fixtures";

let app: TestApp;
const stamp = Date.now();
const ADMIN = `admin-${stamp}@exemple.fr`;
const ADMIN_NO_MFA = `admin-sans-2fa-${stamp}@exemple.fr`;
const ADMIN_UNVERIFIED = `admin-non-confirme-${stamp}@exemple.fr`;

beforeAll(async () => {
  app = await setupTestApp();
  // Casse et espaces volontairement irréguliers : la liste doit être normalisée.
  process.env.ADMIN_EMAILS = ` ${ADMIN.toUpperCase()} ,${ADMIN_NO_MFA},, ${ADMIN_UNVERIFIED}`;
  resetConfigForTests();
});
afterAll(async () => {
  delete process.env.ADMIN_EMAILS;
  resetConfigForTests();
  await app.close();
});

type Route = (req: Request, ctx: never) => Promise<Response>;
const get = (h: Route, path: string, token?: string) => h(apiRequest(path, { token }), undefined as never);
const post = (h: Route, path: string, json: unknown, token?: string, c?: unknown) => h(apiRequest(path, { method: "POST", json, token }), (c ?? undefined) as never);
const body = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const errorCode = async (res: Response) => (await body<{ error: { code: string } }>(res)).error.code;

async function enableMfa(token: string) {
  const { secret } = await body<{ secret: string }>(await post(setupRoute.POST, "/api/account/2fa/setup", undefined, token));
  const res = await post(enableRoute.POST, "/api/account/2fa/enable", { code: hotp(base32Decode(secret), counterAt(Date.now())) }, token);
  expect(res.status).toBe(200);
}

let admin: Awaited<ReturnType<typeof signUp>>;
beforeAll(async () => {
  admin = await signUp(app, { email: ADMIN });
  await enableMfa(admin.token);
});

const ADMIN_ROUTES: [Route, string, "GET" | "POST", unknown?][] = [
  [overviewRoute.GET, "/api/admin/overview", "GET"],
  [usersRoute.GET, "/api/admin/users", "GET"],
  [auditRoute.GET, "/api/admin/audit", "GET"],
  [settingsRoute.POST, "/api/admin/settings", "POST", { key: "uploads_enabled", value: false }],
];
const callAll = async (token?: string) => {
  const statuses: number[] = [];
  for (const [h, path, method, json] of ADMIN_ROUTES) statuses.push((await (method === "GET" ? get(h, path, token) : post(h, path, json, token))).status);
  const target = await signUp(app);
  statuses.push((await post(planRoute.POST, `/api/admin/users/${target.userId}/plan`, { plan: "pro" }, token, ctx(target.userId))).status);
  return statuses;
};

describe("accès à l'administration", () => {
  it("liste des administrateurs normalisée (casse, espaces, entrées vides)", () => {
    expect(isAdminEmail(ADMIN)).toBe(true);
    expect(isAdminEmail(ADMIN.toUpperCase())).toBe(true);
    expect(isAdminEmail(ADMIN_NO_MFA)).toBe(true);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail("quelquun@exemple.fr")).toBe(false);
  });

  it("sans session : 401 partout", async () => {
    expect(new Set(await callAll())).toEqual(new Set([401]));
  });

  it("utilisateur ordinaire : 404 partout (l'interface n'est pas révélée), aucun effet", async () => {
    const u = await signUp(app);
    expect(new Set(await callAll(u.token))).toEqual(new Set([404]));
    expect(await app.db.select().from(adminAudit).where(eq(adminAudit.adminUserId, u.userId))).toHaveLength(0);
  });

  it("administrateur sans double authentification : 403, puis accès une fois activée", async () => {
    const a = await signUp(app, { email: ADMIN_NO_MFA });
    const res = await get(overviewRoute.GET, "/api/admin/overview", a.token);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("admin_mfa_required");
    expect(new Set(await callAll(a.token))).toEqual(new Set([403]));
    await enableMfa(a.token);
    expect((await get(overviewRoute.GET, "/api/admin/overview", a.token)).status).toBe(200);
  });

  it("administrateur à l'adresse non confirmée : 403", async () => {
    const a = await signUp(app, { email: ADMIN_UNVERIFIED, verified: false });
    const res = await get(overviewRoute.GET, "/api/admin/overview", a.token);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("admin_email_unverified");
  });

  it("les écritures exigent la même origine (CSRF)", async () => {
    const res = await settingsRoute.POST(
      apiRequest("/api/admin/settings", { method: "POST", json: { key: "uploads_enabled", value: false }, token: admin.token, origin: "https://malveillant.example" }),
      undefined as never,
    );
    expect(res.status).toBe(403);
  });
});

describe("statistiques sans contenu de document", () => {
  it("compte les documents et analyses sans jamais exposer nom de fichier, texte ou analyse", async () => {
    const u = await signUp(app);
    const SECRET = "Monsieur Zéphyrin Confidentiel, numéro fiscal 1234567890123";
    const doc = await uploadOk(u.token, "dossier-medical-zephyrin.pdf", makePdf([["URSSAF", SECRET, "Montant : 512,00 euros a payer avant le 15/11/2026."]]));
    expect((await post(analyzeRoute.POST, `/api/documents/${doc.id}/analyze`, undefined, u.token, ctx(doc.id))).status).toBe(200);

    const overview = await body<{ users: { total: number }; documents: { total: number; analyzed: number }; ai: { last24h: { calls: number } }; settings: Record<string, boolean>; platform: Record<string, unknown> }>(
      await get(overviewRoute.GET, "/api/admin/overview", admin.token),
    );
    expect(overview.users.total).toBeGreaterThanOrEqual(2);
    expect(overview.documents.total).toBeGreaterThanOrEqual(1);
    expect(overview.documents.analyzed).toBeGreaterThanOrEqual(1);
    expect(overview.ai.last24h.calls).toBeGreaterThanOrEqual(1);
    expect(overview.settings).toMatchObject({ ai_analysis_enabled: true });

    const usersRes = await body<{ users: { email: string; documents: number; analysesThisMonth: number }[] }>(await get(usersRoute.GET, `/api/admin/users?q=${encodeURIComponent(u.email)}`, admin.token));
    expect(usersRes.users).toHaveLength(1);
    expect(usersRes.users[0]).toMatchObject({ email: u.email, documents: 1, analysesThisMonth: 1 });

    const everything = JSON.stringify([overview, usersRes, await body(await get(auditRoute.GET, "/api/admin/audit", admin.token))]);
    for (const leak of ["Zéphyrin", "zephyrin", "1234567890123", "dossier-medical", "512"]) expect(everything).not.toContain(leak);
    // Aucune clé ni secret de configuration
    expect(everything).not.toMatch(/STORAGE_ENCRYPTION_KEY|ANTHROPIC_API_KEY|sk-ant|passwordHash|password_hash|totp/i);
  });
});

describe("gestion des utilisateurs", () => {
  it("changement de formule : appliqué, journalisé, visible dans l'historique de la personne", async () => {
    const u = await signUp(app);
    const res = await post(planRoute.POST, `/api/admin/users/${u.userId}/plan`, { plan: "pro", reason: "Testeur bêta" }, admin.token, ctx(u.userId));
    expect(res.status).toBe(200);
    expect((await app.db.select({ plan: users.plan }).from(users).where(eq(users.id, u.userId)))[0]!.plan).toBe("pro");
    const [entry] = await app.db.select().from(adminAudit).where(eq(adminAudit.targetUserId, u.userId));
    expect(entry).toMatchObject({ adminUserId: admin.userId, adminEmail: ADMIN, action: "user.plan_changed", details: { from: "free", to: "pro", reason: "Testeur bêta" } });
    const activity = await app.db.select().from(activityLog).where(eq(activityLog.userId, u.userId));
    expect(activity.some((a) => a.action === "billing.plan_changed")).toBe(true);
    // Même formule : aucune nouvelle trace
    await post(planRoute.POST, `/api/admin/users/${u.userId}/plan`, { plan: "pro" }, admin.token, ctx(u.userId));
    expect(await app.db.select().from(adminAudit).where(eq(adminAudit.targetUserId, u.userId))).toHaveLength(1);
  });

  it("entrées invalides : formule inconnue 400, compte inconnu ou identifiant invalide 404", async () => {
    const u = await signUp(app);
    expect((await post(planRoute.POST, `/api/admin/users/${u.userId}/plan`, { plan: "illimite" }, admin.token, ctx(u.userId))).status).toBe(400);
    expect((await post(planRoute.POST, `/api/admin/users/x/plan`, { plan: "pro" }, admin.token, ctx("x"))).status).toBe(404);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await post(planRoute.POST, `/api/admin/users/${unknown}/plan`, { plan: "pro" }, admin.token, ctx(unknown))).status).toBe(404);
  });

  it("abonné Stripe : formule non modifiable à la main (409)", async () => {
    const u = await signUp(app);
    await app.db.update(users).set({ plan: "essentiel", subscriptionStatus: "active", subscriptionId: "sub_test" }).where(eq(users.id, u.userId));
    const res = await post(planRoute.POST, `/api/admin/users/${u.userId}/plan`, { plan: "pro" }, admin.token, ctx(u.userId));
    expect(res.status).toBe(409);
    expect((await app.db.select({ plan: users.plan }).from(users).where(eq(users.id, u.userId)))[0]!.plan).toBe("essentiel");
  });

  it("recherche : jokers SQL neutralisés, pagination", async () => {
    const all = await body<{ users: unknown[]; total: number }>(await get(usersRoute.GET, "/api/admin/users", admin.token));
    expect(all.total).toBeGreaterThan(1);
    for (const q of ["%", "_", "\\"]) {
      const r = await body<{ users: { email: string }[] }>(await get(usersRoute.GET, `/api/admin/users?q=${encodeURIComponent(q)}`, admin.token));
      for (const u of r.users) expect(`${u.email}`.includes(q) || JSON.stringify(u).includes(q)).toBe(true);
    }
    const far = await body<{ users: unknown[]; hasMore: boolean }>(await get(usersRoute.GET, "/api/admin/users?page=9999", admin.token));
    expect(far.users).toHaveLength(0);
    expect(far.hasMore).toBe(false);
    expect((await get(usersRoute.GET, "/api/admin/users?page=-5&q=" + "a".repeat(1000), admin.token)).status).toBe(200);
  });
});

describe("interrupteurs", () => {
  it("couper l'IA bloque immédiatement les analyses ; réactiver les rétablit ; tout est journalisé", async () => {
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "c.pdf", makePdf([["URSSAF", "Montant : 100,00 euros avant le 15/11/2026."]]));
    expect((await post(settingsRoute.POST, "/api/admin/settings", { key: "ai_analysis_enabled", value: false }, admin.token)).status).toBe(200);
    expect((await post(analyzeRoute.POST, `/api/documents/${doc.id}/analyze`, undefined, u.token, ctx(doc.id))).status).toBe(503);
    expect((await post(settingsRoute.POST, "/api/admin/settings", { key: "ai_analysis_enabled", value: true }, admin.token)).status).toBe(200);
    expect((await post(analyzeRoute.POST, `/api/documents/${doc.id}/analyze`, undefined, u.token, ctx(doc.id))).status).toBe(200);
    const entries = await body<{ entries: { action: string; details: { key: string; value: boolean } }[] }>(await get(auditRoute.GET, "/api/admin/audit", admin.token));
    expect(entries.entries.filter((e) => e.action === "setting.changed" && e.details.key === "ai_analysis_enabled").map((e) => e.details.value)).toEqual([true, false]);
  });

  it("clé inconnue ou valeur non booléenne : 400 (y compris clés héritées)", async () => {
    for (const payload of [{ key: "admin", value: true }, { key: "__proto__", value: true }, { key: "uploads_enabled", value: "false" }, {}]) {
      expect((await post(settingsRoute.POST, "/api/admin/settings", payload, admin.token)).status).toBe(400);
    }
    await setSetting(app.db, "uploads_enabled", true);
  });
});

describe("conservation", () => {
  it("le journal d'administration est purgé après 24 mois, pas avant", async () => {
    const old = new Date(Date.now() - 25 * 30 * 86_400_000);
    await app.db.insert(adminAudit).values({ adminEmail: "ancien@exemple.fr", action: "setting.changed", createdAt: old });
    const report = await runPurge(app.db, { apply: true });
    expect(report.oldAdminAudit).toBeGreaterThanOrEqual(1);
    expect(await app.db.select().from(adminAudit).where(eq(adminAudit.adminEmail, "ancien@exemple.fr"))).toHaveLength(0);
    expect((await app.db.select().from(adminAudit).where(eq(adminAudit.adminEmail, ADMIN))).length).toBeGreaterThan(0);
  });
});
