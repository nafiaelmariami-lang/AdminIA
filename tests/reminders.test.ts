import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as prefsRoute from "@/app/api/account/notifications/route";
import * as unsubRoute from "@/app/api/notifications/unsubscribe/route";
import * as tokenRoute from "@/app/api/calendar/token/route";
import * as feedRoute from "@/app/api/calendar/feed/route";
import * as cronRoute from "@/app/api/cron/reminders/route";
import { reminderLog, users } from "@/server/db/schema";
import { parisToday, reminderKind, runReminders, unsubscribeUrl } from "@/server/tasks/reminders";
import { resetConfigForTests } from "@/server/config";
import { apiRequest, ctx, memoryEmail, setupTestApp, signUp, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());
beforeEach(async () => {
  memoryEmail.fail = false;
  memoryEmail.sent.length = 0;
  await app.db.delete(reminderLog);
});

const NOW = new Date("2026-10-05T07:00:00Z");
const digests = (to: string) => memoryEmail.sent.filter((m) => m.to === to && m.tag === "reminder_digest");
const inDays = (n: number) => {
  const d = new Date(`${parisToday(NOW)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function addTask(token: string, title: string, dueDate: string | null) {
  const res = await tasksRoute.POST(apiRequest("/api/tasks", { method: "POST", token, json: { title, dueDate } }), undefined);
  return ((await res.json()) as { task: { id: string } }).task.id;
}

describe("type de rappel selon l'échéance", () => {
  it.each([
    [8, null],
    [7, "j7"],
    [2, "j7"],
    [1, "j1"],
    [0, "j1"],
    [-1, "overdue"],
    [-3, "overdue"],
    [-4, null],
  ])("J%i → %s", (days, kind) => expect(reminderKind(days)).toBe(kind));
});

describe("envoi des rappels", () => {
  it("un e-mail récapitulatif par utilisateur, trié, avec lien de désabonnement ; jamais deux fois", async () => {
    const u = await signUp(app);
    await addTask(u.token, "Payer la CFE", inDays(1));
    await addTask(u.token, "Déclarer le CA", inDays(5));
    await addTask(u.token, "Facture en retard", inDays(-2));
    await addTask(u.token, "Lointaine", inDays(30));
    await addTask(u.token, "Sans date", null);

    const dry = await runReminders(app.db, { now: NOW, apply: false });
    expect(dry.remindersSent).toBeGreaterThanOrEqual(3);
    expect(digests(u.email)).toHaveLength(0); // simulation : aucun envoi

    await runReminders(app.db, { now: NOW, apply: true });
    const mails = digests(u.email);
    expect(mails).toHaveLength(1);
    const text = mails[0]!.text;
    expect(text.indexOf("En retard de 2 jours")).toBeLessThan(text.indexOf("Demain"));
    expect(text).toContain("Dans 5 jours — Déclarer le CA");
    expect(text).not.toContain("Lointaine");
    expect(text).not.toContain("Sans date");
    expect(text).toContain("/desabonnement?u=");

    await runReminders(app.db, { now: NOW, apply: true });
    expect(digests(u.email)).toHaveLength(1);
  });

  it("deux exécutions simultanées (plusieurs instances) n'envoient qu'une fois", async () => {
    const u = await signUp(app);
    await addTask(u.token, "Concurrence", inDays(1));
    await Promise.all([runReminders(app.db, { now: NOW, apply: true }), runReminders(app.db, { now: NOW, apply: true }), runReminders(app.db, { now: NOW, apply: true })]);
    expect(digests(u.email)).toHaveLength(1);
  });

  it("une nouvelle date d'échéance réarme les rappels ; une tâche faite n'en reçoit plus", async () => {
    const u = await signUp(app);
    const id = await addTask(u.token, "Reportée", inDays(1));
    await runReminders(app.db, { now: NOW, apply: true });
    await taskRoute.PATCH(apiRequest(`/api/tasks/${id}`, { method: "PATCH", token: u.token, json: { dueDate: inDays(0) } }), ctx(id));
    await runReminders(app.db, { now: NOW, apply: true });
    expect(digests(u.email)).toHaveLength(2);
    const done = await addTask(u.token, "Faite", inDays(1));
    await taskRoute.PATCH(apiRequest(`/api/tasks/${done}`, { method: "PATCH", token: u.token, json: { status: "done" } }), ctx(done));
    await runReminders(app.db, { now: NOW, apply: true });
    expect(digests(u.email).filter((m) => m.text.includes("Faite"))).toHaveLength(0);
  });

  it("échec d'envoi : la réservation est annulée et le rappel repart au passage suivant", async () => {
    const u = await signUp(app);
    await addTask(u.token, "Réessai", inDays(1));
    memoryEmail.fail = true;
    const failed = await runReminders(app.db, { now: NOW, apply: true });
    expect(failed.failedUsers).toBeGreaterThanOrEqual(1);
    memoryEmail.fail = false;
    await runReminders(app.db, { now: NOW, apply: true });
    expect(digests(u.email)).toHaveLength(1);
  });

  it("aucun rappel si l'utilisateur les a désactivés ou n'a pas confirmé son adresse", async () => {
    const off = await signUp(app);
    await addTask(off.token, "Muet", inDays(1));
    expect((await prefsRoute.PATCH(apiRequest("/api/account/notifications", { method: "PATCH", token: off.token, json: { reminderEmails: false } }), undefined)).status).toBe(200);
    const unverified = await signUp(app, { verified: false });
    await addTask(unverified.token, "Non confirmé", inDays(1));
    await runReminders(app.db, { now: NOW, apply: true });
    expect(memoryEmail.sent.filter((m) => m.tag === "reminder_digest" && (m.to === off.email || m.to === unverified.email))).toHaveLength(0);
  });
});

describe("désabonnement sans connexion", () => {
  it("le lien signé désactive les rappels ; un lien falsifié ou d'un autre compte est refusé", async () => {
    const u = await signUp(app);
    const other = await signUp(app);
    const url = new URL(unsubscribeUrl(u.userId));
    const t = url.searchParams.get("t")!;
    const post = (json: unknown) => unsubRoute.POST(apiRequest("/api/notifications/unsubscribe", { method: "POST", json }), undefined);
    expect((await post({ u: other.userId, t })).status).toBe(400);
    expect((await post({ u: u.userId, t: t.slice(0, -2) + "xx" })).status).toBe(400);
    expect((await post({ u: "pas-un-uuid", t })).status).toBe(400);
    expect((await post({ u: u.userId, t })).status).toBe(200);
    const [row] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(row!.reminderEmails).toBe(false);
    const [o] = await app.db.select().from(users).where(eq(users.id, other.userId));
    expect(o!.reminderEmails).toBe(true);
  });
});

describe("abonnement agenda privé", () => {
  it("lien secret montré une fois, flux .ics des échéances, révocable, sans fuite entre comptes", async () => {
    const u = await signUp(app);
    await addTask(u.token, "Dans mon agenda", inDays(3));
    const other = await signUp(app);
    await addTask(other.token, "Agenda de quelqu'un d'autre", inDays(3));

    const created = await tokenRoute.POST(apiRequest("/api/calendar/token", { method: "POST", token: u.token }), undefined);
    const { url } = (await created.json()) as { url: string };
    const token = new URL(url).searchParams.get("token")!;
    const [row] = await app.db.select().from(users).where(eq(users.id, u.userId));
    expect(row!.calendarTokenHash).not.toBe(token); // seul le haché est stocké

    const feed = await feedRoute.GET(apiRequest(`/api/calendar/feed?token=${token}`, { origin: null }), undefined);
    expect(feed.headers.get("content-type")).toMatch(/text\/calendar/);
    const ics = await feed.text();
    expect(ics).toContain("Dans mon agenda");
    expect(ics).not.toContain("quelqu'un d'autre");

    expect((await feedRoute.GET(apiRequest(`/api/calendar/feed?token=${"x".repeat(43)}`, { origin: null }), undefined)).status).toBe(404);
    await tokenRoute.DELETE(apiRequest("/api/calendar/token", { method: "DELETE", token: u.token }), undefined);
    expect((await feedRoute.GET(apiRequest(`/api/calendar/feed?token=${token}`, { origin: null }), undefined)).status).toBe(404);
  });
});

describe("déclenchement HTTP planifié", () => {
  it("désactivé sans CRON_SECRET, refusé avec un mauvais secret, exécuté avec le bon", async () => {
    const call = (auth?: string) => cronRoute.POST(apiRequest("/api/cron/reminders", { method: "POST", origin: null, headers: auth ? { authorization: auth } : {} }), undefined);
    expect((await call("Bearer x")).status).toBe(404);
    process.env.CRON_SECRET = "s".repeat(40);
    resetConfigForTests();
    expect((await call()).status).toBe(404);
    expect((await call(`Bearer ${"t".repeat(40)}`)).status).toBe(404);
    expect((await call(`Bearer ${"s".repeat(40)}`)).status).toBe(200);
    delete process.env.CRON_SECRET;
    resetConfigForTests();
  });
});
