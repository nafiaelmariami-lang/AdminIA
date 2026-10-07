import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export type AnthropicAccessCheck = { ok: boolean; detail: string };

/**
 * Vérifie, SANS AUCUN COÛT, que la clé Anthropic est valide et que le modèle configuré est accessible :
 * lecture de la fiche du modèle (GET /v1/models/{id}), qui ne consomme aucun jeton.
 * N'appelle jamais l'endpoint de génération (/v1/messages). Utilisé par `npm run doctor`.
 */
export async function checkAnthropicAccess(apiKey: string, model: string, client?: Anthropic): Promise<AnthropicAccessCheck> {
  const c = client ?? new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 });
  try {
    const info = await c.models.retrieve(model);
    return { ok: true, detail: `clé valide, modèle ${info.id} accessible (vérification gratuite, aucun jeton consommé)` };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, detail: "clé API refusée (invalide ou révoquée)" };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, detail: "clé sans droits suffisants pour ce modèle" };
    if (err instanceof Anthropic.NotFoundError) return { ok: false, detail: `modèle « ${model} » introuvable ou non accessible avec cette clé` };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, detail: "limite de débit atteinte, réessayez dans quelques instants" };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, detail: "service Anthropic injoignable depuis ce serveur (réseau, pare-feu ou délai)" };
    if (err instanceof Anthropic.APIError) return { ok: false, detail: `erreur du service Anthropic (${err.status ?? "?"})` };
    return { ok: false, detail: "vérification impossible" };
  }
}
