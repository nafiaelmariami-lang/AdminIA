import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import * as analyzeRoute from "@/app/api/documents/[id]/analyze/route";
import { aiCalls, tasks } from "@/server/db/schema";
import { AnthropicProvider } from "@/server/ai/anthropic";
import { setAiProviderForTests } from "@/server/ai/provider";
import { checkAnthropicAccess } from "@/server/ai/check";
import { costUsd } from "@/server/ai/cost";
import { analysisEngine } from "@/server/ai/schema";
import { getAnalysesUsed } from "@/server/billing/usage";
import { apiRequest, ctx, setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";
import { makeDocx, makePdf, makeScannedPdf, PNG_DOC, URSSAF_LETTER } from "./fixtures";
import { sampleRaw } from "./ai-helpers";

/*
 * Parcours d'analyse complet avec le VRAI client Anthropic (SDK officiel) branché sur un FAUX serveur :
 * document stocké chiffré → extraction → requête envoyée → réponse → analyse → échéances → coût journalisé.
 * Aucun appel réseau réel, aucune clé réelle, aucun coût (verrou global dans tests/setup.ts).
 */

const FAKE_KEY = "sk-ant-" + "faux-pour-les-tests-uniquement";
type Captured = { url: string; method: string; headers: Headers; body: Record<string, unknown> | null };

function fakeAnthropic(reply: (req: Captured) => { status?: number; json: unknown; headers?: Record<string, string> }) {
  const requests: Captured[] = [];
  const client = new Anthropic({
    apiKey: FAKE_KEY,
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const req: Captured = {
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      requests.push(req);
      const r = reply(req);
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", "request-id": "req_faux", ...r.headers } });
    },
  });
  return { client, requests };
}

/** Réponse réaliste de claude-opus-5-5 : bloc de réflexion (vide par défaut) puis JSON structuré. */
const opusMessage = (overrides: Record<string, unknown> = {}) => ({
  id: "msg_faux",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [
    { type: "thinking", thinking: "", signature: "signature-fausse" },
    { type: "text", text: JSON.stringify(sampleRaw()) },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 3100, output_tokens: 900 },
  ...overrides,
});

type UserContent = { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[];
const userContent = (req: Captured) => ((req.body!.messages as { role: string; content: UserContent }[])[0]!).content;
const analyze = (token: string, id: string) => analyzeRoute.POST(apiRequest(`/api/documents/${id}/analyze`, { method: "POST", token }), ctx(id));
type AnalyzeBody = { document: { status: string; analysis: { moteur?: string; titre: string } }; tasks: { title: string }[] };

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterEach(() => setAiProviderForTests(null));
afterAll(async () => app.close());

function useFake(reply: Parameters<typeof fakeAnthropic>[0]) {
  const fake = fakeAnthropic(reply);
  setAiProviderForTests(new AnthropicProvider(FAKE_KEY, "claude-opus-5-5", fake.client));
  return fake.requests;
}

describe("parcours complet avec le client Anthropic (faux serveur)", () => {
  it("PDF avec texte : texte extrait envoyé (pas de pièce jointe), analyse « IA réelle », échéances créées, coût journalisé", async () => {
    const requests = useFake(() => ({ json: opusMessage() }));
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "urssaf.pdf", makePdf([URSSAF_LETTER]));
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalyzeBody;

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/v1/messages");
    expect(req.body!.model).toBe("claude-opus-5-5");
    expect(req.headers.get("x-api-key")).toBe(FAKE_KEY);
    const content = userContent(req);
    expect(content.map((c) => c.type)).toEqual(["text"]);
    expect(content[0]!.text).toContain("1 234,56");
    expect(content[0]!.text).toMatch(/<document_utilisateur id="[^"]+">/);

    expect(body.document.status).toBe("analyzed");
    expect(body.document.analysis.moteur).toBe("ia");
    expect(body.tasks.length).toBeGreaterThan(0);
    const [call] = await app.db.select().from(aiCalls).where(eq(aiCalls.documentId, doc.id));
    expect(call).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", status: "success", inputTokens: 3100, outputTokens: 900, providerRequestId: "req_faux" });
    expect(Number(call!.costUsd)).toBeCloseTo(costUsd("claude-opus-5-5", 3100, 900), 6);
    expect(await app.db.select().from(tasks).where(eq(tasks.documentId, doc.id))).not.toHaveLength(0);
  });

  it("DOCX : texte extrait envoyé", async () => {
    const requests = useFake(() => ({ json: opusMessage() }));
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "courrier.docx", makeDocx(URSSAF_LETTER));
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    const content = userContent(requests[0]!);
    expect(content.map((c) => c.type)).toEqual(["text"]);
    expect(content[0]!.text).toContain("1 234,56");
  });

  it("image : envoyée en bloc image, octets identiques au fichier d'origine (déchiffré du stockage)", async () => {
    const requests = useFake(() => ({ json: opusMessage() }));
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "photo.png", PNG_DOC);
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    const content = userContent(requests[0]!);
    expect(content.map((c) => c.type)).toEqual(["image", "text"]);
    expect(content[0]!.source).toMatchObject({ type: "base64", media_type: "image/png" });
    expect(Buffer.from(content[0]!.source!.data, "base64").equals(PNG_DOC)).toBe(true);
  });

  it("PDF scanné de plusieurs pages : envoyé en bloc document, octets identiques", async () => {
    const requests = useFake(() => ({ json: opusMessage() }));
    const u = await signUp(app);
    const scan = makeScannedPdf(3);
    const doc = await uploadOk(u.token, "scan.pdf", scan);
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    const content = userContent(requests[0]!);
    expect(content.map((c) => c.type)).toEqual(["document", "text"]);
    expect(content[0]!.source).toMatchObject({ type: "base64", media_type: "application/pdf" });
    expect(Buffer.from(content[0]!.source!.data, "base64").equals(scan)).toBe(true);
  });

  it("repli après refus : le modèle qui a réellement répondu est journalisé et facturé à son tarif", async () => {
    useFake(() => ({
      json: opusMessage({
        model: "claude-opus-4-8",
        content: [
          { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
          { type: "text", text: JSON.stringify(sampleRaw()) },
        ],
      }),
    }));
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "c.pdf", makePdf([URSSAF_LETTER]));
    expect((await analyze(u.token, doc.id)).status).toBe(200);
    const [call] = await app.db.select().from(aiCalls).where(eq(aiCalls.documentId, doc.id));
    expect(call!.model).toBe("claude-opus-4-8");
    expect(Number(call!.costUsd)).toBeCloseTo(costUsd("claude-opus-4-8", 3100, 900), 6);
  });

  it("clé refusée (401) : analyse en échec explicite, quota rendu, erreur journalisée", async () => {
    useFake(() => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }));
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "c.pdf", makePdf([URSSAF_LETTER]));
    const before = await getAnalysesUsed(app.db, u.userId);
    const res = await analyze(u.token, doc.id);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ai_config_error");
    expect(await getAnalysesUsed(app.db, u.userId)).toBe(before);
    const [call] = await app.db.select().from(aiCalls).where(eq(aiCalls.documentId, doc.id));
    expect(call).toMatchObject({ status: "error", errorCode: "config_error" });
  });

  it("isolation : la requête ne contient que le document de l'utilisateur ; aucun appel pour le document d'un autre compte", async () => {
    const requests = useFake(() => ({ json: opusMessage() }));
    const a = await signUp(app);
    const b = await signUp(app);
    const docA = await uploadOk(a.token, "a.pdf", makePdf([["URSSAF", "Monsieur Alberic Secretdea", "Montant : 100,00 euros"]]));
    const docB = await uploadOk(b.token, "b.pdf", makePdf([["URSSAF", "Madame Beatrice Secretdeb", "Montant : 200,00 euros"]]));
    expect((await analyze(b.token, docB.id)).status).toBe(200);
    const sent = JSON.stringify(requests[0]!.body);
    expect(sent).toContain("Secretdeb");
    expect(sent).not.toContain("Secretdea");
    expect((await analyze(b.token, docA.id)).status).toBe(404);
    expect(requests).toHaveLength(1);
  });

  it("journaux : ni contenu du document, ni clé, ni pièce jointe", async () => {
    const lines: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    process.stdout.write = ((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
    try {
      useFake(() => ({ json: opusMessage() }));
      const u = await signUp(app);
      const doc = await uploadOk(u.token, "c.pdf", makePdf([["URSSAF", "Contribuable Zephyrinlog", "Montant : 321,00 euros"]]));
      await analyze(u.token, doc.id);
      useFake(() => ({ status: 500, json: { type: "error", error: { type: "api_error", message: "panne" } } }));
      const doc2 = await uploadOk(u.token, "d.pdf", makePdf([["URSSAF", "Contribuable Zephyrinlog", "Montant : 321,00 euros"]]));
      await analyze(u.token, doc2.id);
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
    }
    const all = lines.join("");
    expect(all).toContain("ai.analysis_success");
    expect(all).toContain("ai.analysis_failed");
    expect(all).not.toContain("Zephyrinlog");
    expect(all).not.toContain("321,00");
    expect(all).not.toContain(FAKE_KEY);
  });

  it("moteur de démonstration : l'analyse est marquée « démonstration » ; une ancienne analyse sans marque aussi", async () => {
    setAiProviderForTests(null); // AI_PROVIDER=mock dans les tests
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "c.pdf", makePdf([URSSAF_LETTER]));
    const body = (await (await analyze(u.token, doc.id)).json()) as AnalyzeBody;
    expect(body.document.analysis.moteur).toBe("demonstration");
    expect(analysisEngine({})).toBe("demonstration");
    expect(analysisEngine({ moteur: "ia" })).toBe("ia");
  });
});

describe("aucun appel réel possible", () => {
  it("le verrou des tests bloque tout accès à un serveur Anthropic", async () => {
    await expect(fetch("https://api.anthropic.com/v1/messages", { method: "POST" })).rejects.toThrow(/interdit/);
  });

  it("même un client sans faux serveur échoue sans joindre Anthropic (erreur « service injoignable »)", async () => {
    const provider = new AnthropicProvider(FAKE_KEY, "claude-opus-5-5", new Anthropic({ apiKey: FAKE_KEY, maxRetries: 0 }));
    const e = await provider.analyze({ fileName: "a", today: "2026-10-07", text: "x" }).catch((x) => x);
    expect((e as { code: string }).code).toBe("provider_error");
  });
});

describe("vérification gratuite de la clé (npm run doctor)", () => {
  it("lit seulement la fiche du modèle (GET /v1/models/{id}), jamais /v1/messages", async () => {
    const fake = fakeAnthropic(() => ({ json: { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z" } }));
    const r = await checkAnthropicAccess(FAKE_KEY, "claude-opus-5-5", fake.client);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/aucun jeton/);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.method).toBe("GET");
    expect(new URL(fake.requests[0]!.url).pathname).toBe("/v1/models/claude-opus-5-5");
    expect(fake.requests.some((q) => q.url.includes("/v1/messages"))).toBe(false);
  });

  it.each([
    [401, "authentication_error", /clé API refusée/],
    [403, "permission_error", /droits/],
    [404, "not_found_error", /introuvable/],
    [429, "rate_limit_error", /débit/],
    [500, "api_error", /erreur du service/],
  ])("erreur %i → message clair", async (status, type, expected) => {
    const fake = fakeAnthropic(() => ({ status, json: { type: "error", error: { type, message: "x" } } }));
    const r = await checkAnthropicAccess(FAKE_KEY, "claude-opus-5-5", fake.client);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(expected);
    expect(r.detail).not.toContain(FAKE_KEY);
  });

  it("réseau indisponible → message clair (et le verrou empêche tout appel réel)", async () => {
    const r = await checkAnthropicAccess(FAKE_KEY, "claude-opus-5-5", new Anthropic({ apiKey: FAKE_KEY, maxRetries: 0 }));
    expect(r).toEqual({ ok: false, detail: expect.stringMatching(/injoignable/) });
  });
});
