import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import * as docsRoute from "@/app/api/documents/route";
import * as docRoute from "@/app/api/documents/[id]/route";
import * as fileRoute from "@/app/api/documents/[id]/file/route";
import * as analyzeRoute from "@/app/api/documents/[id]/analyze/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as calendarRoute from "@/app/api/tasks/calendar/route";
import * as exportRoute from "@/app/api/account/export/route";
import * as activityRoute from "@/app/api/activity/route";
import { apiRequest, ctx, setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";
import { makePdf, URSSAF_LETTER } from "./fixtures";

let app: TestApp;
let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;
let aliceDocId: string;
let aliceTaskId: string;

beforeAll(async () => {
  app = await setupTestApp();
  alice = await signUp(app);
  bob = await signUp(app);
  const doc = await uploadOk(alice.token, "secret-alice.pdf", makePdf([[...URSSAF_LETTER, "SECRET-ALICE-42"]]));
  aliceDocId = doc.id;
  await analyzeRoute.POST(apiRequest(`/api/documents/${doc.id}/analyze`, { method: "POST", token: alice.token }), ctx(doc.id));
  const t = await tasksRoute.POST(apiRequest("/api/tasks", { method: "POST", token: alice.token, json: { title: "Tâche d'Alice", dueDate: "2026-12-01" } }), undefined);
  aliceTaskId = ((await t.json()) as { task: { id: string } }).task.id;
});
afterAll(async () => app.close());

describe("isolation stricte entre utilisateurs", () => {
  it("Bob ne voit pas les documents d'Alice (liste et recherche)", async () => {
    const res = await docsRoute.GET(apiRequest("/api/documents?q=SECRET-ALICE-42", { token: bob.token }), undefined);
    expect(((await res.json()) as { total: number }).total).toBe(0);
    const all = await docsRoute.GET(apiRequest("/api/documents", { token: bob.token }), undefined);
    expect(((await all.json()) as { total: number }).total).toBe(0);
  });

  it("Bob reçoit 404 (et non 403) sur chaque action visant le document d'Alice", async () => {
    const id = aliceDocId;
    const r = (p: string, method = "GET", json?: unknown) => apiRequest(p, { method, token: bob.token, json });
    expect((await docRoute.GET(r(`/api/documents/${id}`), ctx(id))).status).toBe(404);
    expect((await docRoute.PATCH(r(`/api/documents/${id}`, "PATCH", { title: "piraté" }), ctx(id))).status).toBe(404);
    expect((await docRoute.DELETE(r(`/api/documents/${id}`, "DELETE"), ctx(id))).status).toBe(404);
    expect((await fileRoute.GET(r(`/api/documents/${id}/file`), ctx(id))).status).toBe(404);
    expect((await analyzeRoute.POST(r(`/api/documents/${id}/analyze`, "POST"), ctx(id))).status).toBe(404);
    // Le document d'Alice est intact.
    const still = await docRoute.GET(apiRequest(`/api/documents/${id}`, { token: alice.token }), ctx(id));
    expect(((await still.json()) as { document: { title: string } }).document.title).not.toBe("piraté");
  });

  it("Bob ne peut ni lire, ni modifier, ni supprimer, ni exporter les échéances d'Alice", async () => {
    const id = aliceTaskId;
    const list = await tasksRoute.GET(apiRequest("/api/tasks?status=all", { token: bob.token }), undefined);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(0);
    expect((await taskRoute.PATCH(apiRequest(`/api/tasks/${id}`, { method: "PATCH", token: bob.token, json: { status: "done" } }), ctx(id))).status).toBe(404);
    expect((await taskRoute.DELETE(apiRequest(`/api/tasks/${id}`, { method: "DELETE", token: bob.token }), ctx(id))).status).toBe(404);
    expect((await calendarRoute.GET(apiRequest(`/api/tasks/calendar?id=${id}`, { token: bob.token }), undefined)).status).toBe(404);
  });

  it("Bob ne peut pas rattacher une échéance au document d'Alice", async () => {
    const res = await tasksRoute.POST(apiRequest("/api/tasks", { method: "POST", token: bob.token, json: { title: "x", documentId: aliceDocId } }), undefined);
    expect(res.status).toBe(404);
  });

  it("l'export et l'historique de Bob ne contiennent aucune donnée d'Alice", async () => {
    const res = await exportRoute.GET(apiRequest("/api/account/export", { token: bob.token }), undefined);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const data = strFromU8(files["donnees.json"]!);
    expect(data).not.toContain("SECRET-ALICE-42");
    expect(data).not.toContain(alice.email);
    expect(Object.keys(files).filter((f) => f.startsWith("documents/"))).toHaveLength(0);
    const act = await activityRoute.GET(apiRequest("/api/activity", { token: bob.token }), undefined);
    const items = ((await act.json()) as { items: { documentId: string | null }[] }).items;
    expect(items.every((i) => i.documentId !== aliceDocId)).toBe(true);
  });

  it("les identifiants malformés renvoient 404 sans erreur serveur", async () => {
    for (const id of ["1", "' OR 1=1 --", "../etc/passwd", "00000000-0000-0000-0000-000000000000"]) {
      expect((await docRoute.GET(apiRequest(`/api/documents/x`, { token: bob.token }), ctx(id))).status).toBe(404);
      expect((await taskRoute.PATCH(apiRequest(`/api/tasks/x`, { method: "PATCH", token: bob.token, json: {} }), ctx(id))).status).toBe(404);
    }
  });

  it("toutes les routes protégées exigent une session", async () => {
    const anon = (p: string, method = "GET") => apiRequest(p, { method });
    const id = aliceDocId;
    const results = await Promise.all([
      docsRoute.GET(anon("/api/documents"), undefined),
      docRoute.GET(anon(`/api/documents/${id}`), ctx(id)),
      fileRoute.GET(anon(`/api/documents/${id}/file`), ctx(id)),
      analyzeRoute.POST(anon(`/api/documents/${id}/analyze`, "POST"), ctx(id)),
      tasksRoute.GET(anon("/api/tasks"), undefined),
      calendarRoute.GET(anon("/api/tasks/calendar"), undefined),
      exportRoute.GET(anon("/api/account/export"), undefined),
      activityRoute.GET(anon("/api/activity"), undefined),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(401));
  });
});
