import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_ATTEMPT_TIMEOUT_MS, AI_MAX_RETRIES, AI_TOTAL_DEADLINE_MS, AnthropicProvider, mapError, parseAnalysisResponse } from "@/server/ai/anthropic";
import { RawAnalysisSchema } from "@/server/ai/schema";
import { AiError } from "@/server/ai/types";
import { sampleRaw } from "./ai-helpers";

const resp = (stop_reason: string | null, text: string | null) => ({
  stop_reason,
  content: text === null ? [] : [{ type: "text", text }],
  usage: { input_tokens: 1500, output_tokens: 400 },
});
const VALID = JSON.stringify(sampleRaw());

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    // L'usage est conservé pour que le coût soit journalisé même en cas d'échec.
    expect((e as AiError).usage).toEqual({ inputTokens: 1500, outputTokens: 400 });
    return (e as AiError).code;
  }
  return "ok";
}

describe("ordre des contrôles de la réponse IA", () => {
  it("1. refus détecté avant tout le reste, même avec un JSON valide", () => {
    expect(codeOf(() => parseAnalysisResponse(resp("refusal", VALID)))).toBe("refusal");
  });

  it("2. réponse tronquée détectée AVANT la lecture du JSON (même si le JSON semble valide)", () => {
    expect(codeOf(() => parseAnalysisResponse(resp("max_tokens", '{"titre": "coup')))).toBe("truncated");
    expect(codeOf(() => parseAnalysisResponse(resp("max_tokens", VALID)))).toBe("truncated");
  });

  it("3. tout autre motif d'arrêt est refusé (seul end_turn est accepté)", () => {
    for (const reason of ["pause_turn", "tool_use", "stop_sequence", "motif_inconnu", null]) {
      expect(codeOf(() => parseAnalysisResponse(resp(reason, VALID)))).toBe("invalid_output");
    }
  });

  it("4. réponse vide ou sans bloc texte", () => {
    expect(codeOf(() => parseAnalysisResponse(resp("end_turn", null)))).toBe("invalid_output");
    expect(codeOf(() => parseAnalysisResponse(resp("end_turn", "   ")))).toBe("invalid_output");
    expect(codeOf(() => parseAnalysisResponse({ ...resp("end_turn", null), content: [{ type: "thinking" }] }))).toBe("invalid_output");
  });

  it("5. JSON syntaxiquement invalide", () => {
    expect(codeOf(() => parseAnalysisResponse(resp("end_turn", "Voici l'analyse : {…}")))).toBe("invalid_output");
  });

  it("6. JSON valide mais non conforme au schéma Zod", () => {
    expect(codeOf(() => parseAnalysisResponse(resp("end_turn", '{"titre": "x"}')))).toBe("invalid_output");
    const wrongType = { ...sampleRaw(), montant_a_payer: "mille euros" };
    expect(codeOf(() => parseAnalysisResponse(resp("end_turn", JSON.stringify(wrongType))))).toBe("invalid_output");
    const wrongEnum = { ...sampleRaw(), niveau_urgence: "apocalyptique" };
    expect(codeOf(() => parseAnalysisResponse(resp("end_turn", JSON.stringify(wrongEnum))))).toBe("invalid_output");
  });

  it("réponse correcte : données validées et usage renvoyés", () => {
    const out = parseAnalysisResponse(resp("end_turn", VALID));
    expect(out.raw.titre).toBe(sampleRaw().titre);
    expect(out.inputTokens).toBe(1500);
  });

  it("le texte réparti sur plusieurs blocs est réassemblé ; les blocs non textuels sont ignorés", () => {
    const half = Math.floor(VALID.length / 2);
    const out = parseAnalysisResponse({
      stop_reason: "end_turn",
      content: [{ type: "thinking" }, { type: "text", text: VALID.slice(0, half) }, { type: "text", text: VALID.slice(half) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(out.raw.categorie).toBe("urssaf");
  });
});

describe("erreurs de l'API traduites en erreurs typées", () => {
  const providerReturning = (status: number) =>
    new AnthropicProvider(
      "k",
      "claude-opus-5-5",
      new Anthropic({
        apiKey: "sk-test-non-reelle",
        maxRetries: 0,
        fetch: async () =>
          new Response(JSON.stringify({ type: "error", error: { type: "x", message: "détail interne" } }), {
            status,
            headers: { "content-type": "application/json", "request-id": "req_test_123" },
          }),
      }),
    );

  it.each([
    [429, "rate_limited"],
    [500, "provider_error"],
    [529, "overloaded"],
    [400, "provider_error"],
    [401, "config_error"],
    [403, "config_error"],
    [413, "too_large"],
  ])("HTTP %i → %s", async (status, code) => {
    const err = await providerReturning(status).analyze({ fileName: "a", today: "2026-10-05", text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe(code);
    expect((err as AiError).message).not.toContain("détail interne");
    expect((err as AiError).requestId).toBe("req_test_123");
  });

  it("erreur réseau → provider_error", async () => {
    const provider = new AnthropicProvider(
      "k",
      "claude-opus-5-5",
      new Anthropic({ apiKey: "k", maxRetries: 0, fetch: async () => { throw new TypeError("fetch failed"); } }),
    );
    const err = await provider.analyze({ fileName: "a", today: "2026-10-05", text: "x" }).catch((e) => e);
    expect((err as AiError).code).toBe("provider_error");
  });
});

describe("intégration complète avec l'API (sans clé réelle)", () => {
  const ok = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: VALID }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 2000, output_tokens: 500 },
    ...overrides,
  });

  it("renvoie l'identifiant de requête, le motif d'arrêt et le modèle réellement utilisé (repli)", async () => {
    const provider = new AnthropicProvider(
      "k",
      "claude-opus-5-5",
      new Anthropic({ apiKey: "k", maxRetries: 0, fetch: async () => ok(message({ model: "claude-opus-4-8" }), { "request-id": "req_abc" }) }),
    );
    const out = await provider.analyze({ fileName: "a", today: "2026-10-05", text: "x" });
    expect(out.requestId).toBe("req_abc");
    expect(out.stopReason).toBe("end_turn");
    expect(out.model).toBe("claude-opus-4-8");
  });

  it("une réponse invalide conserve l'identifiant de requête (support)", async () => {
    const provider = new AnthropicProvider(
      "k",
      "claude-opus-5-5",
      new Anthropic({ apiKey: "k", maxRetries: 0, fetch: async () => ok(message({ stop_reason: "max_tokens" }), { "request-id": "req_trunc" }) }),
    );
    const err = (await provider.analyze({ fileName: "a", today: "2026-10-05", text: "x" }).catch((e) => e)) as AiError;
    expect(err.code).toBe("truncated");
    expect(err.requestId).toBe("req_trunc");
    expect(err.usage.outputTokens).toBe(500);
  });

  it("une erreur temporaire est retentée une seule fois, jamais en boucle", async () => {
    let calls = 0;
    const client = new Anthropic({
      apiKey: "k",
      maxRetries: 1,
      fetch: async () => {
        calls++;
        return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } }), {
          status: 529,
          headers: { "content-type": "application/json", "retry-after-ms": "1" },
        });
      },
    });
    const err = (await new AnthropicProvider("k", "claude-opus-5-5", client).analyze({ fileName: "a", today: "2026-10-05", text: "x" }).catch((e) => e)) as AiError;
    expect(err.code).toBe("overloaded");
    expect(calls).toBe(2);
  });

  it("le délai global interrompt un appel qui ne répond pas", async () => {
    const err = mapError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect(err.code).toBe("timeout");
  });

  it("les limites de temps tiennent dans la durée maximale de la route d'analyse", async () => {
    const { maxDuration } = await import("@/app/api/documents/[id]/analyze/route");
    expect(AI_ATTEMPT_TIMEOUT_MS * (AI_MAX_RETRIES + 1)).toBeLessThanOrEqual(AI_TOTAL_DEADLINE_MS);
    expect(AI_TOTAL_DEADLINE_MS).toBeLessThan(maxDuration * 1000);
  });
});

describe("schéma JSON envoyé pour les sorties structurées", () => {
  const format = betaZodOutputFormat(RawAnalysisSchema) as unknown as { type: string; schema: Record<string, unknown> };
  const objects: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object") objects.push(n);
    Object.values(n).forEach(walk);
  };
  walk(format.schema);

  it("est de type json_schema", () => expect(format.type).toBe("json_schema"));

  it("chaque objet interdit les propriétés supplémentaires et exige toutes ses propriétés", () => {
    expect(objects.length).toBeGreaterThan(5);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...((o.required as string[]) ?? [])].sort()).toEqual(Object.keys(o.properties as object).sort());
    }
  });

  it("n'utilise pas de contraintes non prises en charge par les sorties structurées", () => {
    const text = JSON.stringify(format.schema);
    for (const kw of ['"minLength"', '"maxLength"', '"minimum"', '"maximum"', '"pattern"', '"minItems"', '"maxItems"']) expect(text).not.toContain(kw);
  });
});
