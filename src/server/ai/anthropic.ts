import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { RawAnalysisSchema, type RawAnalysis } from "./schema";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { MAX_OUTPUT_TOKENS } from "./cost";
import { AiError, type AiProvider, type AnalysisInput, type AnalysisOutput } from "./types";

/**
 * Budget de temps : 2 tentatives × 60 s, plus une échéance globale de 130 s qui interrompt
 * l'appel dans tous les cas. Reste inférieur au `maxDuration` (150 s) de la route d'analyse
 * et au délai au-delà duquel une analyse est considérée comme abandonnée (5 min).
 */
export const AI_ATTEMPT_TIMEOUT_MS = 60_000;
export const AI_MAX_RETRIES = 1;
export const AI_TOTAL_DEADLINE_MS = 130_000;

/** Modèles acceptant `effort` et le repli serveur `fallbacks: "default"` en cas de refus. */
const SUPPORTS_EFFORT = (m: string) => !m.includes("haiku");
const SUPPORTS_DEFAULT_FALLBACK = (m: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(m);

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Anthropic,
  ) {
    // Tentatives bornées (pas de boucle) : 1 nouvelle tentative au plus, 60 s par tentative.
    this.client = client ?? new Anthropic({ apiKey, maxRetries: AI_MAX_RETRIES, timeout: AI_ATTEMPT_TIMEOUT_MS });
  }

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    const attachmentKind = input.attachment ? (input.attachment.mediaType === "application/pdf" ? "pdf" : "image") : undefined;
    const { text } = buildUserMessage({
      today: input.today,
      fileName: input.fileName,
      documentText: input.text,
      attachmentKind,
    });

    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.attachment) {
      const data = input.attachment.data.toString("base64");
      if (input.attachment.mediaType === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
      } else {
        content.push({ type: "image", source: { type: "base64", media_type: input.attachment.mediaType, data } });
      }
    }
    content.push({ type: "text", text });

    const useFallback = SUPPORTS_DEFAULT_FALLBACK(this.model);
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        output_config: {
          ...(SUPPORTS_EFFORT(this.model) ? { effort: "low" as const } : {}),
          format: betaZodOutputFormat(RawAnalysisSchema),
        },
        // Repli automatique côté serveur si le modèle refuse (classificateurs de sécurité).
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      }, { signal: AbortSignal.timeout(AI_TOTAL_DEADLINE_MS) });
    } catch (err) {
      throw mapError(err);
    }

    const requestId = (response as { _request_id?: string | null })._request_id ?? null;
    try {
      return { ...parseAnalysisResponse(response), model: response.model, requestId, stopReason: response.stop_reason };
    } catch (err) {
      if (err instanceof AiError) throw new AiError(err.code, err.message, err.usage, requestId);
      throw err;
    }
  }
}

/**
 * Valide la réponse de l'API, dans un ordre strict :
 *   1. refus (stop_reason « refusal ») ;
 *   2. réponse tronquée (stop_reason « max_tokens ») — avant toute lecture du JSON, forcément incomplet ;
 *   3. tout autre arrêt inattendu (seul « end_turn » est accepté) ;
 *   4. présence d'un texte ;
 *   5. JSON syntaxiquement valide ;
 *   6. conformité au schéma Zod.
 * Chaque échec lève une AiError typée qui conserve la consommation de jetons (pour le journal des coûts).
 * La sortie de l'IA n'est jamais utilisée sans être passée par ces six contrôles.
 */
export function parseAnalysisResponse(response: {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}): { raw: RawAnalysis; inputTokens: number; outputTokens: number } {
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === "refusal") throw new AiError("refusal", "Le modèle a refusé d'analyser ce document.", usage);
  if (response.stop_reason === "max_tokens") throw new AiError("truncated", "Réponse de l'IA incomplète.", usage);
  if (response.stop_reason !== "end_turn") throw new AiError("invalid_output", `Arrêt inattendu de l'IA (${response.stop_reason ?? "inconnu"}).`, usage);

  const outputText = response.content
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("")
    .trim();
  if (!outputText) throw new AiError("invalid_output", "Réponse de l'IA vide.", usage);

  let json: unknown;
  try {
    json = JSON.parse(outputText);
  } catch {
    throw new AiError("invalid_output", "Réponse de l'IA illisible (JSON invalide).", usage);
  }
  const parsed = RawAnalysisSchema.safeParse(json);
  if (!parsed.success) throw new AiError("invalid_output", "Réponse de l'IA non conforme au schéma.", usage);
  return { raw: parsed.data, ...usage };
}

/** Traduit les erreurs du SDK en erreurs typées, de la plus spécifique à la plus générale. */
export function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const requestId = err instanceof Anthropic.APIError ? (err.requestID ?? null) : null;
  const make = (code: AiError["code"], message: string) => new AiError(code, message, undefined, requestId);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return make("timeout", "Délai dépassé.");
  if (err instanceof Anthropic.APIUserAbortError) return make("timeout", "Délai global dépassé.");
  if (err instanceof Anthropic.APIConnectionError) return make("provider_error", "Service IA injoignable.");
  if (err instanceof Anthropic.RateLimitError) return make("rate_limited", "Limite de débit du service IA atteinte.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return make("config_error", "Clé API invalide ou droits insuffisants.");
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return make("overloaded", "Service IA surchargé.");
    if (err.status === 413) return make("too_large", "Requête trop volumineuse pour le service IA.");
    if (err.status === 408) return make("timeout", "Délai dépassé côté service IA.");
    return make("provider_error", `Erreur du service IA (${err.status ?? "?"}).`);
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return make("timeout", "Délai global dépassé.");
  return make("provider_error", "Erreur du service IA.");
}
