/**
 * Estimation et calcul des coûts IA (en dollars US).
 * Les prix sont ceux de l'API Claude (septembre 2026), par million de jetons.
 * Un modèle inconnu est facturé au tarif le plus élevé, par prudence.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  mock: { input: 0, output: 0 },
};
const FALLBACK_PRICE = { input: 10, output: 50 };

/** Plafond de jetons de sortie par analyse (réflexion comprise) : borne dure du coût de sortie. */
export const MAX_OUTPUT_TOKENS = 8_000;

/** Hypothèses prudentes d'estimation (surestiment volontairement). */
const CHARS_PER_TOKEN = 3; // le français fait ~3,5–4 caractères par jeton
const PROMPT_OVERHEAD_TOKENS = 2_500; // prompt système + schéma de sortie + consignes
// Opus 5.5 / Sonnet 5.5 lisent les images en haute résolution : jusqu'à ~4 784 jetons par image.
const IMAGE_TOKENS = 4_800;
const PDF_PAGE_TOKENS = 5_000; // page PDF envoyée en mode visuel (image de la page + texte)

export function priceFor(model: string) {
  return PRICES[model] ?? FALLBACK_PRICE;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function estimateInputTokens(opts: { textChars: number; mode: "text" | "vision"; kind: "pdf" | "image" | "other"; pages: number }): number {
  let tokens = PROMPT_OVERHEAD_TOKENS;
  if (opts.mode === "text") tokens += Math.ceil(opts.textChars / CHARS_PER_TOKEN);
  else if (opts.kind === "image") tokens += IMAGE_TOKENS;
  else tokens += Math.max(1, opts.pages) * PDF_PAGE_TOKENS;
  return tokens;
}

/** Coût maximal plausible d'une analyse : entrée estimée + sortie au plafond. */
export function estimateMaxCostUsd(model: string, inputTokens: number): number {
  return costUsd(model, inputTokens, MAX_OUTPUT_TOKENS);
}
