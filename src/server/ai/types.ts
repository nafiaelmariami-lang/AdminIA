import type { RawAnalysis } from "./schema";

export type AttachmentMediaType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export type AnalysisInput = {
  fileName: string;
  today: string; // AAAA-MM-JJ
  /** Texte extrait (mode texte) ou null (mode vision : la pièce jointe est envoyée). */
  text: string | null;
  attachment?: { mediaType: AttachmentMediaType; data: Buffer };
};

export type AnalysisOutput = {
  raw: RawAnalysis;
  /** Modèle ayant réellement répondu (peut différer en cas de repli après refus). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Identifiant de requête du fournisseur, pour le support (aucun contenu). */
  requestId?: string | null;
  stopReason?: string | null;
};

/**
 * Codes d'erreur IA.
 *  - refusal / truncated / invalid_output : la réponse existe mais est inutilisable ;
 *  - timeout / rate_limited / overloaded : temporaire, l'utilisateur peut réessayer plus tard ;
 *  - too_large : la requête dépasse les limites de l'API ;
 *  - config_error : clé invalide ou permissions (alerte exploitant, jamais la faute de l'utilisateur) ;
 *  - provider_error : toute autre erreur du fournisseur.
 */
export type AiErrorCode =
  | "refusal"
  | "truncated"
  | "invalid_output"
  | "timeout"
  | "rate_limited"
  | "overloaded"
  | "too_large"
  | "config_error"
  | "provider_error";

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly usage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: AnalysisInput): Promise<AnalysisOutput>;
}
