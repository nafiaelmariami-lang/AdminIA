import "server-only";
import { z } from "zod";

/**
 * Configuration serveur, validée au démarrage.
 * Toute valeur sensible reste ici : ce module ne doit jamais être importé côté client
 * (garanti par `server-only`).
 */
const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("pglite://./.data/pglite"),
  STORAGE_DIR: z.string().min(1).default("./.data/files"),
  STORAGE_ENCRYPTION_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(["anthropic", "mock"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().min(1).default("claude-opus-5-5"),
  AI_ENABLED: bool.default(true),
  AI_MAX_COST_PER_DOC_USD: z.coerce.number().positive().default(0.5),
  AI_USER_DAILY_BUDGET_USD: z.coerce.number().positive().default(2),
  AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
  TRUST_PROXY: bool.default(false),
});

export type AppConfig = z.infer<typeof schema> & { storageKey: Buffer };

let cached: AppConfig | null = null;

function emptyToUndefined(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) out[k] = v === "" ? undefined : v;
  return out;
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(emptyToUndefined(process.env));
  if (!parsed.success) {
    throw new Error(`Configuration invalide : ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === "production";

  let storageKey: Buffer;
  if (env.STORAGE_ENCRYPTION_KEY) {
    storageKey = Buffer.from(env.STORAGE_ENCRYPTION_KEY, "base64");
    if (storageKey.length !== 32) throw new Error("STORAGE_ENCRYPTION_KEY doit faire 32 octets (base64).");
  } else if (isProd) {
    throw new Error("STORAGE_ENCRYPTION_KEY est obligatoire en production.");
  } else {
    // Clé de développement déterministe : uniquement hors production.
    storageKey = Buffer.alloc(32, 7);
  }

  if (isProd && env.DATABASE_URL.startsWith("pglite:")) {
    throw new Error("PGlite est réservé au développement et aux tests.");
  }
  if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY est requis quand AI_PROVIDER=anthropic.");
  }

  cached = { ...env, storageKey };
  return cached;
}

/** Réservé aux tests. */
export function resetConfigForTests(): void {
  cached = null;
}
