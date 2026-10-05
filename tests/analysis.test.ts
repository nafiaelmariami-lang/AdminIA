import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as analyzeRoute from "@/app/api/documents/[id]/analyze/route";
import * as docRoute from "@/app/api/documents/[id]/route";
import { aiCalls, documents, tasks, usageCounters } from "@/server/db/schema";
import { setAiProviderForTests } from "@/server/ai/provider";
import { resetConfigForTests } from "@/server/config";
import { setSetting } from "@/server/settings";
import { currentPeriod } from "@/server/billing/usage";
import { hitRateLimit } from "@/server/security/rate-limit";
import { AiError } from "@/server/ai/types";
import { apiRequest, ctx, setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";
import { makePdf, PNG_DOC, URSSAF_LETTER } from "./fixtures";
import { deferred, sampleRaw, SpyProvider } from "./ai-helpers";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());
afterEach(() => {
  setAiProviderForTests(null);
  for (const k of ["AI_MAX_COST_PER_DOC_USD", "AI_USER_DAILY_BUDGET_USD", "AI_DAILY_BUDGET_USD", "AI_ENABLED"]) delete process.env[k];
  resetConfigForTests();
});

const analyze = (token: string, id: string) => analyzeRoute.POST(apiRequest(`/api/documents/${id}/analyze`, { method: "POST", token }), ctx(id));
const used = async (userId: string) =>
  (await app.db.select().from(usageCounters).where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, currentPeriod()))))[0]?.analysesUsed ?? 0;

let n = 0;
const newDoc = async (token: string) => uploadOk(token, `courrier-${++n}.pdf`, makePdf([[...URSSAF_LETTER, `Exemplaire ${n} ${Math.random()}`]]));

describe("analyse IA — cas nominal", () => {
  it("analyse, extrait la structure, crée les échéances, consomme le quota et journalise le coût", async () => {
    const spy = new SpyProvider();
    setAiProviderForTests(spy);
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: Record<string, unknown> & { analysis: Record<string, unknown> }; tasks: { title: string; dueDate: string; source: string }[] };
    expect(body.document.status).toBe("analyzed");
    expect(body.document.category).toBe("urssaf");
    expect(body.document.organism).toBe("Urssaf Île-de-France");
    expect(body.document.amountDue).toBe("1234.56");
    expect(body.document.urgency).toBe("eleve");
    expect(body.document.analysis.resume).toMatch(/Urssaf/);
    // 1 action + 1 échéance non couverte (la contestation) = 2 tâches
    expect(body.tasks.map((t) => [t.title, t.dueDate]).sort()).toEqual([
      ["Fin du délai de contestation", "2026-12-02"],
      ["Payer 1 234,56 € sur urssaf.fr", "2026-11-15"],
    ]);
    expect(await used(u.userId)).toBe(1);

    const [call] = await app.db.select().from(aiCalls).where(eq(aiCalls.documentId, doc.id));
    expect(call!.status).toBe("success");
    expect(call!.inputTokens).toBe(3000);
    expect(Number(call!.costUsd)).toBeCloseTo((3000 * 4 + 1000 * 20) / 1e6, 6);
    // Le journal des appels ne contient aucun contenu de document.
    expect(Object.keys(call!)).not.toContain("prompt");
    expect(JSON.stringify(call)).not.toContain("cotisations");

    // L'IA a reçu le texte du document, sans pièce jointe.
    expect(spy.calls[0]!.text).toContain("cotisations");
    expect(spy.calls[0]!.attachment).toBeUndefined();
  });

  it("envoie les images à l'IA en pièce jointe (mode vision)", async () => {
    const spy = new SpyProvider();
    setAiProviderForTests(spy);
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "photo.png", PNG_DOC);
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    expect(spy.calls[0]!.text).toBeNull();
    expect(spy.calls[0]!.attachment!.mediaType).toBe("image/png");
    expect(spy.calls[0]!.attachment!.data.equals(PNG_DOC)).toBe(true);
  });

  it("normalise une réponse IA aberrante (dates invalides, montants absurdes, textes trop longs)", async () => {
    setAiProviderForTests(
      new SpyProvider(() =>
        sampleRaw({
          titre: "T".repeat(5000),
          date_document: "2026-02-30",
          montant_a_payer: 1e15,
          echeances: [
            { date: "demain", libelle: "Invalide", type: "paiement" },
            { date: "31/12/2026", libelle: "Valide au format français", type: "autre" },
          ],
          actions_requises: [],
          categorie: "inconnue" as never,
        }),
      ),
    );
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    const body = (await (await analyze(u.token, doc.id)).json()) as { document: { title: string; documentDate: null; amountDue: null; category: string }; tasks: { dueDate: string }[] };
    expect(body.document.title.length).toBeLessThanOrEqual(200);
    expect(body.document.documentDate).toBeNull();
    expect(body.document.amountDue).toBeNull();
    expect(body.document.category).toBe("autre");
    expect(body.tasks.map((t) => t.dueDate)).toEqual(["2026-12-31"]);
  });

  it("une nouvelle analyse remplace les tâches IA à faire mais conserve les tâches terminées", async () => {
    setAiProviderForTests(new SpyProvider());
    const u = await signUp(app, { plan: "pro" });
    const doc = await newDoc(u.token);
    await analyze(u.token, doc.id);
    const first = await app.db.select().from(tasks).where(eq(tasks.documentId, doc.id));
    await app.db.update(tasks).set({ status: "done" }).where(eq(tasks.id, first[0]!.id));
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    const after = await app.db.select().from(tasks).where(eq(tasks.documentId, doc.id));
    expect(after.filter((t) => t.status === "done")).toHaveLength(1);
    expect(after).toHaveLength(3);
    expect(await used(u.userId)).toBe(2);
  });
});

describe("analyse IA — erreurs", () => {
  it("échec du fournisseur : document en échec, quota rendu, appel journalisé, nouvelle tentative possible", async () => {
    const spy = new SpyProvider(() => {
      throw new AiError("provider_error", "boom", { inputTokens: 100, outputTokens: 0 });
    });
    setAiProviderForTests(spy);
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(502);
    const msg = ((await res.json()) as { error: { message: string } }).error.message;
    expect(msg).not.toMatch(/boom/); // pas de détail technique exposé
    const [row] = await app.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row!.status).toBe("failed");
    expect(row!.errorMessage).toBeTruthy();
    expect(await used(u.userId)).toBe(0);
    const [call] = await app.db.select().from(aiCalls).where(eq(aiCalls.documentId, doc.id));
    expect(call!.status).toBe("error");
    expect(call!.errorCode).toBe("provider_error");

    spy.respond = () => sampleRaw();
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    expect(await used(u.userId)).toBe(1);
  });

  it("une erreur inattendue (bug) est contenue et ne fuit pas", async () => {
    setAiProviderForTests(new SpyProvider(() => {
      throw new TypeError("Cannot read properties of undefined (secret interne)");
    }));
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret interne");
  });

  it("refus du modèle : statut « refused » et message neutre", async () => {
    setAiProviderForTests(new SpyProvider(() => {
      throw new AiError("refusal", "refus");
    }));
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    expect((await analyze(u.token, doc.id)).status).toBe(502);
    const [call] = await app.db.select().from(aiCalls).where(eq(aiCalls.documentId, doc.id));
    expect(call!.status).toBe("refused");
  });

  it("document inexistant ou supprimé : 404", async () => {
    const u = await signUp(app);
    expect((await analyze(u.token, "6f1c2a3e-1111-4222-8333-444455556666")).status).toBe(404);
  });
});

describe("protection des coûts (côté serveur)", () => {
  it("quota mensuel atteint : 402, sans appel IA", async () => {
    const spy = new SpyProvider();
    setAiProviderForTests(spy);
    const u = await signUp(app); // 5 analyses / mois
    await app.db.insert(usageCounters).values({ userId: u.userId, period: currentPeriod(), analysesUsed: 5 });
    const doc = await newDoc(u.token);
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(402);
    expect(spy.calls).toHaveLength(0);
    const [row] = await app.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row!.status).toBe("uploaded"); // verrou annulé (transaction)
    expect(row!.analysisAttempts).toBe(0);
  });

  it("plafond de coût par document : 413, sans appel IA ni consommation de quota", async () => {
    process.env.AI_MAX_COST_PER_DOC_USD = "0.01";
    resetConfigForTests();
    const spy = new SpyProvider();
    setAiProviderForTests(spy);
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    expect((await analyze(u.token, doc.id)).status).toBe(413);
    expect(spy.calls).toHaveLength(0);
    expect(await used(u.userId)).toBe(0);
  });

  it("budget quotidien par utilisateur : 429", async () => {
    const spy = new SpyProvider();
    setAiProviderForTests(spy);
    const u = await signUp(app);
    await app.db.insert(aiCalls).values({ userId: u.userId, provider: "spy", model: "claude-opus-5-5", estimatedCostUsd: "1.95", costUsd: "1.95", status: "success" });
    const doc = await newDoc(u.token);
    expect((await analyze(u.token, doc.id)).status).toBe(429);
    expect(spy.calls).toHaveLength(0);
  });

  it("budget quotidien global : coupe-circuit 503", async () => {
    process.env.AI_DAILY_BUDGET_USD = "5";
    resetConfigForTests();
    const spy = new SpyProvider();
    setAiProviderForTests(spy);
    await app.db.insert(aiCalls).values({ userId: null, provider: "spy", model: "claude-opus-5-5", estimatedCostUsd: "4.95", costUsd: "4.95", status: "success" });
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    expect((await analyze(u.token, doc.id)).status).toBe(503);
    expect(spy.calls).toHaveLength(0);
    await app.db.delete(aiCalls).where(eq(aiCalls.estimatedCostUsd, "4.950000"));
  });

  it("interrupteurs : AI_ENABLED=false et réglage ai_analysis_enabled", async () => {
    setAiProviderForTests(new SpyProvider());
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    process.env.AI_ENABLED = "false";
    resetConfigForTests();
    expect((await analyze(u.token, doc.id)).status).toBe(503);
    delete process.env.AI_ENABLED;
    resetConfigForTests();
    await setSetting(app.db, "ai_analysis_enabled", false);
    expect((await analyze(u.token, doc.id)).status).toBe(503);
    await setSetting(app.db, "ai_analysis_enabled", true);
    expect((await analyze(u.token, doc.id)).status).toBe(200);
  });

  it("limite de fréquence horaire des analyses", async () => {
    setAiProviderForTests(new SpyProvider());
    const u = await signUp(app, { plan: "pro" }); // 30 / heure
    for (let i = 0; i < 30; i++) await hitRateLimit(app.db, `analyze:${u.userId}`, 30, 3600);
    const doc = await newDoc(u.token);
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("nombre de tentatives par document borné (anti-boucle)", async () => {
    setAiProviderForTests(new SpyProvider());
    const u = await signUp(app, { plan: "pro" });
    const doc = await newDoc(u.token);
    await app.db.update(documents).set({ analysisAttempts: 5 }).where(eq(documents.id, doc.id));
    expect((await analyze(u.token, doc.id)).status).toBe(429);
  });
});

describe("concurrence", () => {
  it("cinq analyses simultanées du même document : une seule passe, un seul quota consommé", async () => {
    const gate = deferred();
    const spy = new SpyProvider(async () => {
      await gate.promise;
      return sampleRaw();
    });
    setAiProviderForTests(spy);
    const u = await signUp(app, { plan: "pro" });
    const doc = await newDoc(u.token);
    const pending = Array.from({ length: 5 }, () => analyze(u.token, doc.id));
    await new Promise((r) => setTimeout(r, 300));
    gate.resolve();
    const statuses = (await Promise.all(pending)).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    expect(spy.calls).toHaveLength(1);
    expect(await used(u.userId)).toBe(1);
  });

  it("pas de suppression pendant une analyse en cours", async () => {
    const gate = deferred();
    setAiProviderForTests(new SpyProvider(async () => {
      await gate.promise;
      return sampleRaw();
    }));
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    const running = analyze(u.token, doc.id);
    await new Promise((r) => setTimeout(r, 200));
    const del = await docRoute.DELETE(apiRequest(`/api/documents/${doc.id}`, { method: "DELETE", token: u.token }), ctx(doc.id));
    expect(del.status).toBe(409);
    gate.resolve();
    expect((await running).status).toBe(200);
  });

  it("analyses simultanées de plusieurs documents : le quota n'est jamais dépassé", async () => {
    setAiProviderForTests(new SpyProvider(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return sampleRaw();
    }));
    const u = await signUp(app, { plan: "essentiel" }); // 40 / mois
    await app.db.insert(usageCounters).values({ userId: u.userId, period: currentPeriod(), analysesUsed: 38 });
    const docs = await Promise.all(Array.from({ length: 6 }, () => newDoc(u.token)));
    // Plusieurs vagues concurrentes jusqu'à épuisement
    let ok = 0;
    for (let wave = 0; wave < 4; wave++) {
      const res = await Promise.all(docs.map((d) => analyze(u.token, d.id)));
      ok += res.filter((r) => r.status === 200).length;
      for (const r of res) expect([200, 402, 409, 429]).toContain(r.status); // 429 : limite horaire, autre garde-fou
    }
    expect(ok).toBe(2);
    expect(await used(u.userId)).toBe(40);
  });

  it("une analyse bloquée depuis plus de 5 minutes peut être relancée", async () => {
    setAiProviderForTests(new SpyProvider());
    const u = await signUp(app);
    const doc = await newDoc(u.token);
    await app.db.update(documents).set({ status: "processing", processingStartedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(documents.id, doc.id));
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    await app.db.update(documents).set({ status: "processing", processingStartedAt: new Date() }).where(eq(documents.id, doc.id));
    expect((await analyze(u.token, doc.id)).status).toBe(409);
  });
});
