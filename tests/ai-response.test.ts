import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider, parseAnalysisResponse } from "@/server/ai/anthropic";
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
        fetch: async () => new Response(JSON.stringify({ type: "error", error: { type: "x", message: "détail interne" } }), { status, headers: { "content-type": "application/json" } }),
      }),
    );

  it.each([
    [429, "rate_limited"],
    [500, "provider_error"],
    [529, "provider_error"],
    [400, "provider_error"],
    [401, "provider_error"],
  ])("HTTP %i → %s", async (status, code) => {
    const err = await providerReturning(status).analyze({ fileName: "a", today: "2026-10-05", text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe(code);
    expect((err as AiError).message).not.toContain("détail interne");
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
