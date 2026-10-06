import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as resendRoute from "@/app/api/auth/verify-email/resend/route";
import * as forgotRoute from "@/app/api/auth/password/forgot/route";
import * as emailRoute from "@/app/api/account/email/route";
import * as analyzeRoute from "@/app/api/documents/[id]/analyze/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as verifyRoute from "@/app/api/admin/users/[id]/verify-email/route";
import * as auditRoute from "@/app/api/admin/audit/route";
import * as setupRoute from "@/app/api/account/2fa/setup/route";
import * as enableRoute from "@/app/api/account/2fa/enable/route";
import * as meRoute from "@/app/api/auth/me/route";
import { activityLog, adminAudit, reminderLog, sessions, users } from "@/server/db/schema";
import { resetConfigForTests } from "@/server/config";
import { isEmailDeliveryEnabled } from "@/server/email";
import { runReminders, parisToday } from "@/server/tasks/reminders";
import { base32Decode, counterAt, hotp } from "@/server/auth/totp";
import { verifyEmailFromCli } from "@/server/admin/service";
import { apiRequest, ctx, memoryEmail, setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";
import { makePdf, URSSAF_LETTER } from "./fixtures";

/*
 * Bêta sans e-mail (EMAIL_DRIVER=disabled) : aucun faux « lien envoyé », confirmation manuelle
 * par un administrateur, aucune réinitialisation de mot de passe par l'administrateur.
 */

let app: TestApp;
const stamp = Date.now();
const ADMIN = `admin-sans-email-${stamp}@exemple.fr`;
const ADMIN_NO_MFA = `admin-sans-2fa-sans-email-${stamp}@exemple.fr`;

beforeAll(async () => {
  app = await setupTestApp();
  process.env.EMAIL_DRIVER = "disabled";
  process.env.ADMIN_EMAILS = `${ADMIN},${ADMIN_NO_MFA}`;
  resetConfigForTests();
});
afterAll(async () => {
  delete process.env.EMAIL_DRIVER;
  delete process.env.ADMIN_EMAILS;
  resetConfigForTests();
  await app.close();
});
beforeEach(() => {
  memoryEmail.fail = false;
  memoryEmail.sent.length = 0;
});

type Route = (req: Request, ctx: never) => Promise<Response>;
const post = (h: Route, path: string, json: unknown, token?: string, c?: unknown) => h(apiRequest(path, { method: "POST", json, token }), (c ?? undefined) as never);
const body = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const err = async (res: Response) => (await body<{ error: { code: string; message: string } }>(res)).error;
const analyze = (token: string, id: string) => post(analyzeRoute.POST, `/api/documents/${id}/analyze`, undefined, token, ctx(id));
const verify = (token: string | undefined, id: string) => post(verifyRoute.POST, `/api/admin/users/${id}/verify-email`, undefined, token, ctx(id));

async function enableMfa(token: string) {
  const { secret } = await body<{ secret: string }>(await post(setupRoute.POST, "/api/account/2fa/setup", undefined, token));
  expect((await post(enableRoute.POST, "/api/account/2fa/enable", { code: hotp(base32Decode(secret), counterAt(Date.now())) }, token)).status).toBe(200);
}

describe("e-mails désactivés : aucun faux succès", () => {
  it("le réglage est bien détecté", () => {
    expect(isEmailDeliveryEnabled()).toBe(false);
  });

  it("renvoi du lien de confirmation : refus explicite (503), aucun e-mail", async () => {
    const u = await signUp(app, { verified: false });
    memoryEmail.sent.length = 0;
    const res = await post(resendRoute.POST, "/api/auth/verify-email/resend", {}, u.token);
    expect(res.status).toBe(503);
    const e = await err(res);
    expect(e.code).toBe("email_disabled");
    expect(e.message).toMatch(/pas encore activé/);
    expect(e.message).not.toMatch(/envoyé/);
    expect(memoryEmail.sent).toHaveLength(0);
  });

  it("mot de passe oublié : même réponse explicite pour une adresse inscrite ou inconnue, aucun e-mail", async () => {
    const u = await signUp(app);
    const known = await post(forgotRoute.POST, "/api/auth/password/forgot", { email: u.email });
    const unknown = await post(forgotRoute.POST, "/api/auth/password/forgot", { email: `inconnu-${stamp}@exemple.fr` });
    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(await known.json()).toEqual(await unknown.json());
    expect(memoryEmail.sent).toHaveLength(0);
  });

  it("changement d'adresse : refusé avec explication, rien n'est enregistré", async () => {
    const u = await signUp(app);
    const res = await post(emailRoute.POST, "/api/account/email", { newEmail: `nouvelle-${stamp}@exemple.fr`, password: u.password }, u.token);
    expect(res.status).toBe(503);
    expect((await err(res)).code).toBe("email_disabled");
    expect((await app.db.select({ p: users.pendingEmail }).from(users).where(eq(users.id, u.userId)))[0]!.p).toBeNull();
    expect(memoryEmail.sent).toHaveLength(0);
  });

  it("analyse d'un compte non confirmé : message qui renvoie vers l'équipe, pas vers un lien inexistant", async () => {
    const u = await signUp(app, { verified: false });
    const doc = await uploadOk(u.token, "c.pdf", makePdf([URSSAF_LETTER]));
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(403);
    const e = await err(res);
    expect(e.code).toBe("email_not_verified");
    expect(e.message).toMatch(/équipe AdminIA/);
    expect(e.message).not.toMatch(/lien envoyé/);
  });

  it("rappels : rien n'est marqué « envoyé » ; ils partent une fois l'envoi réactivé", async () => {
    const now = new Date("2026-10-05T07:00:00Z");
    const d = new Date(`${parisToday(now)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const u = await signUp(app);
    const created = await tasksRoute.POST(apiRequest("/api/tasks", { method: "POST", token: u.token, json: { title: "Payer la CFE", dueDate: d.toISOString().slice(0, 10) } }), undefined);
    const taskId = ((await created.json()) as { task: { id: string } }).task.id;

    const report = await runReminders(app.db, { now, apply: true });
    expect(report).toMatchObject({ skipped: "email_disabled", remindersSent: 0 });
    expect(await app.db.select().from(reminderLog).where(eq(reminderLog.taskId, taskId))).toHaveLength(0);
    expect(memoryEmail.sent).toHaveLength(0);

    process.env.EMAIL_DRIVER = "outbox";
    resetConfigForTests();
    try {
      const after = await runReminders(app.db, { now, apply: true });
      expect(after.skipped).toBeUndefined();
      expect(memoryEmail.sent.some((m) => m.to === u.email && m.tag === "reminder_digest")).toBe(true);
    } finally {
      process.env.EMAIL_DRIVER = "disabled";
      resetConfigForTests();
    }
  });
});

describe("confirmation manuelle de l'adresse par un administrateur", () => {
  let adm: Awaited<ReturnType<typeof signUp>>;
  beforeAll(async () => {
    adm = await signUp(app, { email: ADMIN });
    await enableMfa(adm.token);
  });

  it("parcours : le testeur est bloqué, l'administrateur confirme, l'analyse fonctionne", async () => {
    const u = await signUp(app, { verified: false });
    const doc = await uploadOk(u.token, "courrier.pdf", makePdf([URSSAF_LETTER]));
    expect((await analyze(u.token, doc.id)).status).toBe(403);

    const res = await verify(adm.token, u.userId);
    expect(res.status).toBe(200);
    const result = await body(res);
    expect(result).toEqual({ verified: true, alreadyVerified: false });
    // Aucune donnée du compte ou des documents dans la réponse.
    expect(JSON.stringify(result)).not.toMatch(/courrier|URSSAF|@/i);

    expect((await analyze(u.token, doc.id)).status).toBe(200);
    expect(((await body<{ user: { emailVerified: boolean } }>(await meRoute.GET(apiRequest("/api/auth/me", { token: u.token }), undefined))).user.emailVerified)).toBe(true);
  });

  it("journalisé côté administration et visible dans l'historique de la personne ; idempotent", async () => {
    const u = await signUp(app, { verified: false });
    await verify(adm.token, u.userId);
    const again = await verify(adm.token, u.userId);
    expect(await body(again)).toEqual({ verified: true, alreadyVerified: true });

    const audits = await app.db.select().from(adminAudit).where(eq(adminAudit.targetUserId, u.userId));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "user.email_verified", adminEmail: ADMIN, adminUserId: adm.userId });
    const history = await app.db.select().from(activityLog).where(eq(activityLog.userId, u.userId));
    expect(history.filter((h) => h.action === "account.email_verified")).toHaveLength(1);
    expect(history.find((h) => h.action === "account.email_verified")?.details).toEqual({ par: "équipe AdminIA" });

    const entries = await body<{ entries: { action: string; targetEmail: string | null }[] }>(await auditRoute.GET(apiRequest("/api/admin/audit", { token: adm.token }), undefined as never));
    expect(entries.entries.some((e) => e.action === "user.email_verified" && e.targetEmail === u.email)).toBe(true);
  });

  it("ne touche ni au mot de passe, ni aux sessions, ni à la double authentification ; aucun e-mail", async () => {
    const u = await signUp(app, { verified: false });
    const [before] = await app.db.select().from(users).where(eq(users.id, u.userId));
    const sessionsBefore = await app.db.select().from(sessions).where(eq(sessions.userId, u.userId));
    await verify(adm.token, u.userId);
    const [after] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(after!.passwordHash).toBe(before!.passwordHash);
    expect(after!.passwordChangedAt).toEqual(before!.passwordChangedAt);
    expect(after!.totpEnabledAt).toEqual(before!.totpEnabledAt);
    expect(after!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await app.db.select().from(sessions).where(eq(sessions.userId, u.userId))).toHaveLength(sessionsBefore.length);
    expect(memoryEmail.sent).toHaveLength(0);
  });

  it("accès : sans session 401 ; utilisateur ordinaire 404 ; administrateur sans 2FA 403 ; aucun effet", async () => {
    const target = await signUp(app, { verified: false });
    const ordinary = await signUp(app);
    const noMfa = await signUp(app, { email: ADMIN_NO_MFA });
    expect((await verify(undefined, target.userId)).status).toBe(401);
    expect((await verify(ordinary.token, target.userId)).status).toBe(404);
    const r = await verify(noMfa.token, target.userId);
    expect(r.status).toBe(403);
    expect((await err(r)).code).toBe("admin_mfa_required");
    expect((await app.db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, target.userId)))[0]!.v).toBeNull();
  });

  it("identifiant invalide ou inconnu : 404 ; requête d'une autre origine refusée (CSRF)", async () => {
    expect((await verify(adm.token, "pas-un-uuid")).status).toBe(404);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await verify(adm.token, unknown)).status).toBe(404);
    const target = await signUp(app, { verified: false });
    const csrf = await verifyRoute.POST(
      apiRequest(`/api/admin/users/${target.userId}/verify-email`, { method: "POST", token: adm.token, origin: "https://malveillant.example" }),
      ctx(target.userId) as never,
    );
    expect(csrf.status).toBe(403);
    expect((await app.db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, target.userId)))[0]!.v).toBeNull();
  });

  it("aucune route ne permet à l'administrateur de réinitialiser un mot de passe", async () => {
    const { readdirSync } = await import("node:fs");
    const adminRoutes = readdirSync("src/app/api/admin", { recursive: true }).map(String);
    expect(adminRoutes.filter((p) => /password|mot-de-passe|reset/i.test(p))).toEqual([]);
  });
});

describe("confirmation depuis le serveur (amorçage du premier administrateur)", () => {
  it("simulation par défaut, puis confirmation journalisée ; compte inconnu signalé ; idempotent", async () => {
    const u = await signUp(app, { verified: false });
    expect(await verifyEmailFromCli(app.db, "inconnu@exemple.fr", { apply: true })).toEqual({ found: false });

    const dry = await verifyEmailFromCli(app.db, ` ${u.email.toUpperCase()} `, { apply: false });
    expect(dry).toMatchObject({ found: true, changed: false });
    expect((await app.db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, u.userId)))[0]!.v).toBeNull();

    expect(await verifyEmailFromCli(app.db, u.email, { apply: true })).toMatchObject({ found: true, changed: true });
    expect((await app.db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, u.userId)))[0]!.v).toBeInstanceOf(Date);
    const audits = await app.db.select().from(adminAudit).where(eq(adminAudit.targetUserId, u.userId));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "user.email_verified", adminUserId: null, adminEmail: "ligne de commande (serveur)" });
    expect((await app.db.select().from(activityLog).where(eq(activityLog.userId, u.userId))).some((a) => a.action === "account.email_verified")).toBe(true);

    expect(await verifyEmailFromCli(app.db, u.email, { apply: true })).toMatchObject({ changed: false });
    expect(await app.db.select().from(adminAudit).where(eq(adminAudit.targetUserId, u.userId))).toHaveLength(1);
  });
});
