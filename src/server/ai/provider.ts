import "server-only";
import { getConfig } from "@/server/config";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { AiProvider } from "./types";

let override: AiProvider | null = null;
let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (override) return override;
  if (cached) return cached;
  const cfg = getConfig();
  cached = cfg.AI_PROVIDER === "anthropic" ? new AnthropicProvider(cfg.ANTHROPIC_API_KEY!, cfg.AI_MODEL) : new MockProvider();
  return cached;
}

export function isDemoMode(): boolean {
  return getAiProvider().name === "mock";
}

/** Tests : remplace le fournisseur. */
export function setAiProviderForTests(provider: AiProvider | null): void {
  override = provider;
}
