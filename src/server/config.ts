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
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("fr-par"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PREFIX: z.string().optional(),
  AI_PROVIDER: z.enum(["anthropic", "mock"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().min(1).default("claude-opus-5-5"),
  AI_ENABLED: bool.default(true),
  AI_MAX_COST_PER_DOC_USD: z.coerce.number().positive().default(0.5),
  AI_USER_DAILY_BUDGET_USD: z.coerce.number().positive().default(2),
  AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
  TRUST_PROXY: bool.default(false),
  // E-mails transactionnels
  EMAIL_DRIVER: z.enum(["outbox", "brevo", "disabled"]).default("outbox"),
  EMAIL_FROM: z.string().email().default("ne-pas-repondre@adminia.local"),
  EMAIL_FROM_NAME: z.string().min(1).default("AdminIA"),
  EMAIL_OUTBOX_DIR: z.string().min(1).default("./.data/outbox"),
  BREVO_API_KEY: z.string().optional(),
  EMAIL_VERIFICATION_REQUIRED: bool.default(true),
  /**
   * Adresses des administrateurs, séparées par des virgules. Vide = aucune interface d'administration.
   * Un administrateur doit avoir confirmé son adresse ET activé la double authentification.
   */
  ADMIN_EMAILS: z.string().optional(),
  /** Secret des tâches planifiées appelées par HTTP (ex. /api/cron/reminders). Vide = route désactivée. */
  CRON_SECRET: z.string().min(32).optional(),
  // Paiement (Stripe). Sans clé, le paiement est simplement désactivé dans l'interface.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ESSENTIEL_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ESSENTIEL_YEARLY: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
  /** Calcul automatique de la TVA par Stripe Tax (à configurer dans le tableau de bord Stripe). */
  STRIPE_AUTOMATIC_TAX: bool.default(false),
  /** Tests de bout en bout sur un build de production LOCAL uniquement. Ne jamais activer sur un vrai serveur. */
  EMAIL_OUTBOX_IN_PRODUCTION_FOR_TESTS: bool.default(false),
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
  if (env.STORAGE_DRIVER === "s3" && (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
    throw new Error("STORAGE_DRIVER=s3 exige S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY.");
  }
  if (env.STORAGE_DRIVER === "s3" && env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith("https://") && isProd) {
    throw new Error("S3_ENDPOINT doit utiliser HTTPS en production.");
  }
  if (env.STRIPE_SECRET_KEY) {
    const missing = ["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ESSENTIEL_MONTHLY", "STRIPE_PRICE_PRO_MONTHLY"].filter((k) => !env[k as keyof typeof env]);
    if (missing.length) throw new Error(`Paiement activé mais configuration incomplète : ${missing.join(", ")}.`);
    if (isProd && env.STRIPE_SECRET_KEY.startsWith("sk_test_")) console.warn("[config] Stripe en mode TEST en production.");
  }
  if (env.EMAIL_DRIVER === "brevo" && !env.BREVO_API_KEY) throw new Error("BREVO_API_KEY est requis quand EMAIL_DRIVER=brevo.");
  const localProdTest = isProd && env.EMAIL_OUTBOX_IN_PRODUCTION_FOR_TESTS;
  if (localProdTest) console.warn("[config] ATTENTION : boîte d'envoi locale activée en production (tests locaux uniquement).");
  if (isProd && env.EMAIL_DRIVER === "outbox" && !localProdTest) {
    throw new Error("EMAIL_DRIVER=outbox est réservé au développement : configurez brevo (ou disabled).");
  }
  if (isProd && env.EMAIL_FROM.endsWith(".local") && !localProdTest) throw new Error("EMAIL_FROM doit être une adresse de votre domaine en production.");
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
