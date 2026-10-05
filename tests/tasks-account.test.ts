import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as calendarRoute from "@/app/api/tasks/calendar/route";
import * as accountRoute from "@/app/api/account/route";
import * as exportRoute from "@/app/api/account/export/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as analyzeRoute from "@/app/api/documents/[id]/analyze/route";
import { aiCalls, documents, tasks, users } from "@/server/db/schema";
import { buildIcs } from "@/server/tasks/ics";
import { decrypt, encrypt, LocalEncryptedStorage } from "@/server/storage";
import { setAiProviderForTests } from "@/server/ai/provider";
import { apiRequest, ctx, setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";
import { makePdf, URSSAF_LETTER } from "./fixtures";
import { SpyProvider } from "./ai-helpers";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());

describe("échéances", () => {
  it("création manuelle, validation de date, passage à « fait », suppression", async () => {
    const u = await signUp(app);
    const create = (json: unknown) => tasksRoute.POST(apiRequest("/api/tasks", { method: "POST", token: u.token, json }), undefined);
    expect((await create({ title: "", dueDate: "2026-12-01" })).status).toBe(400);
    expect((await create({ title: "Déclarer la TVA", dueDate: "2026-13-45" })).status).toBe(400);
    expect((await create({ title: "x", userId: u.userId })).status).toBe(400); // champ inconnu refusé
    const res = await create({ title: "Déclarer le CA Urssaf", dueDate: "31/10/2026", priority: "haute" });
    expect(res.status).toBe(201);
    const { task } = (await res.json()) as { task: { id: string; dueDate: string; status: string } };
    expect(task.dueDate).toBe("2026-10-31");

    const done = await taskRoute.PATCH(apiRequest(`/api/tasks/${task.id}`, { method: "PATCH", token: u.token, json: { status: "done" } }), ctx(task.id));
    expect(((await done.json()) as { task: { status: string; completedAt: string } }).task.completedAt).toBeTruthy();
    const todo = await tasksRoute.GET(apiRequest("/api/tasks", { token: u.token }), undefined);
    expect(((await todo.json()) as { items: unknown[] }).items).toHaveLength(0);
    expect((await taskRoute.DELETE(apiRequest(`/api/tasks/${task.id}`, { method: "DELETE", token: u.token }), ctx(task.id))).status).toBe(200);
  });

  it("export agenda .ics conforme (échappement, rappels, lignes pliées)", async () => {
    const ics = buildIcs([
      { id: "a", title: "Payer, vite; avec \\ et\nretour", dueDate: "2026-11-15", documentTitle: "Courrier Urssaf" },
      { id: "b", title: "Sans date", dueDate: null },
      { id: "c", title: "T".repeat(200), dueDate: "2026-12-31" },
    ]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261115");
    expect(ics).toContain("DTEND;VALUE=DATE:20261116");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(ics).toContain("Payer\\, vite\; avec \\\\ et\\nretour");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);

    const u = await signUp(app);
    await tasksRoute.POST(apiRequest("/api/tasks", { method: "POST", token: u.token, json: { title: "Renouveler l'assurance", dueDate: "2027-01-01" } }), undefined);
    const res = await calendarRoute.GET(apiRequest("/api/tasks/calendar", { token: u.token }), undefined);
    expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
    expect(await res.text()).toContain("Renouveler l'assurance");
  });
});

describe("compte : synthèse, export RGPD, suppression", () => {
  it("synthèse de consommation", async () => {
    const u = await signUp(app);
    await uploadOk(u.token, "a.txt", Buffer.from("contenu"));
    const body = (await (await accountRoute.GET(apiRequest("/api/account", { token: u.token }), undefined)).json()) as {
      usage: { documents: number; analysesLimit: number; storageBytes: number };
      user: Record<string, unknown>;
    };
    expect(body.usage.documents).toBe(1);
    expect(body.usage.analysesLimit).toBe(5);
    expect(body.usage.storageBytes).toBe(7);
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("export ZIP : données complètes et fichiers originaux déchiffrés", async () => {
    setAiProviderForTests(new SpyProvider());
    const u = await signUp(app);
    const pdf = makePdf([URSSAF_LETTER]);
    const doc = await uploadOk(u.token, "urssaf.pdf", pdf);
    await analyzeRoute.POST(apiRequest(`/api/documents/${doc.id}/analyze`, { method: "POST", token: u.token }), ctx(doc.id));
    const res = await exportRoute.GET(apiRequest("/api/account/export", { token: u.token }), undefined);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const data = JSON.parse(strFromU8(files["donnees.json"]!)) as {
      compte: { email: string; passwordHash?: string };
      documents: { analysis: { titre: string }; fichier: string; storageKey?: string }[];
      echeances: unknown[];
      historique: unknown[];
    };
    expect(data.compte.email).toBe(u.email);
    expect(data.compte.passwordHash).toBeUndefined();
    expect(data.documents[0]!.analysis.titre).toMatch(/Urssaf/);
    expect(data.documents[0]!.storageKey).toBeUndefined();
    expect(data.echeances.length).toBeGreaterThan(0);
    expect(data.historique.length).toBeGreaterThan(0);
    expect(Buffer.from(files[data.documents[0]!.fichier]!).equals(pdf)).toBe(true);
    setAiProviderForTests(null);
  });

  it("suppression : exige mot de passe et confirmation, efface tout, anonymise les coûts", async () => {
    setAiProviderForTests(new SpyProvider());
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "a.pdf", makePdf([["à effacer"]]));
    await analyzeRoute.POST(apiRequest(`/api/documents/${doc.id}/analyze`, { method: "POST", token: u.token }), ctx(doc.id));
    const del = (json: unknown) => accountRoute.DELETE(apiRequest("/api/account", { method: "DELETE", token: u.token, json }), undefined);
    expect((await del({ password: u.password })).status).toBe(400);
    expect((await del({ password: "Mauvais-Mot-De-Passe", confirm: "SUPPRIMER" })).status).toBe(401);
    expect(existsSync(path.join(app.storageDir, u.userId))).toBe(true);

    const res = await del({ password: u.password, confirm: "SUPPRIMER" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await app.db.select().from(users).where(eq(users.id, u.userId))).toHaveLength(0);
    expect(await app.db.select().from(documents).where(eq(documents.userId, u.userId))).toHaveLength(0);
    expect(await app.db.select().from(tasks).where(eq(tasks.userId, u.userId))).toHaveLength(0);
    expect(existsSync(path.join(app.storageDir, u.userId))).toBe(false);
    const calls = await app.db.select().from(aiCalls).where(eq(aiCalls.documentId, doc.id));
    expect(calls).toHaveLength(0); // document_id passé à NULL
    expect((await meRoute.GET(apiRequest("/api/auth/me", { token: u.token }), undefined)).status).toBe(401);
    const relog = await loginRoute.POST(apiRequest("/api/auth/login", { method: "POST", json: { email: u.email, password: u.password } }), undefined);
    expect(relog.status).toBe(401);
    setAiProviderForTests(null);
  });
});

describe("stockage chiffré", () => {
  const key = Buffer.alloc(32, 3);
  const k1 = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222";
  const k2 = "33333333-3333-3333-3333-333333333333/22222222-2222-2222-2222-222222222222";

  it("chiffre puis déchiffre ; chaque chiffrement est unique", () => {
    const a = encrypt(key, k1, Buffer.from("secret"));
    const b = encrypt(key, k1, Buffer.from("secret"));
    expect(a.equals(b)).toBe(false);
    expect(decrypt(key, k1, a).toString()).toBe("secret");
  });

  it("détecte une altération, une mauvaise clé et un fichier déplacé vers un autre compte", () => {
    const blob = encrypt(key, k1, Buffer.from("secret"));
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decrypt(key, k1, tampered)).toThrow();
    expect(() => decrypt(Buffer.alloc(32, 4), k1, blob)).toThrow();
    expect(() => decrypt(key, k2, blob)).toThrow();
  });

  it("refuse les clés de stockage malformées (traversée de répertoire)", async () => {
    const s = new LocalEncryptedStorage("/tmp/adminia-never", key);
    await expect(s.get("../../etc/passwd")).rejects.toThrow(/invalide/);
    await expect(s.deleteUser("../..")).rejects.toThrow(/invalide/);
  });
});
