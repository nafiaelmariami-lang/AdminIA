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
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type AiErrorCode = "refusal" | "truncated" | "invalid_output" | "timeout" | "rate_limited" | "provider_error";

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly usage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
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
