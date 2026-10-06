import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DocumentAnalysis } from "@/server/ai/schema";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    plan: text("plan", { enum: ["free", "essentiel", "pro"] }).notNull().default("free"),
    // Facturation (Stripe). Mise à jour UNIQUEMENT par les webhooks signés, jamais par le navigateur.
    billingCustomerId: text("billing_customer_id"),
    planRenewsAt: timestamp("plan_renews_at", { withTimezone: true }),
    subscriptionId: text("subscription_id"),
    subscriptionStatus: text("subscription_status"),
    billingInterval: text("billing_interval", { enum: ["month", "year"] }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** Horodatage du dernier événement Stripe appliqué (ignore les événements arrivés en retard). */
    billingEventAt: timestamp("billing_event_at", { withTimezone: true }),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** Preuve du consentement aux CGU et à la politique de confidentialité (version acceptée). */
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    termsVersion: text("terms_version"),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    /** Rappels d'échéances par e-mail (désactivables à tout moment, lien dans chaque e-mail). */
    reminderEmails: boolean("reminder_emails").notNull().default(true),
    /** Nouvelle adresse en attente de confirmation (lien envoyé à cette adresse). */
    pendingEmail: text("pending_email"),
    /** Ancienne adresse, conservée 7 jours pour permettre l'annulation d'un changement non sollicité. */
    previousEmail: text("previous_email"),
    /** Double authentification (TOTP) : secret chiffré, activation, dernier compteur utilisé (anti-rejeu). */
    totpSecretEnc: text("totp_secret_enc"),
    totpPendingSecretEnc: text("totp_pending_secret_enc"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    totpLastCounter: integer("totp_last_counter"),
    /** Date d'envoi de l'avertissement de suppression pour inactivité (remis à zéro à la connexion). */
    inactivityNoticeSentAt: timestamp("inactivity_notice_sent_at", { withTimezone: true }),
    /** Abonnement agenda privé : seul le haché du jeton est stocké. */
    calendarTokenHash: text("calendar_token_hash"),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    uniqueIndex("users_calendar_token_unique").on(t.calendarTokenHash),
    uniqueIndex("users_billing_customer_unique").on(t.billingCustomerId),
  ],
);

export const AUTH_TOKEN_PURPOSES = ["verify_email", "reset_password", "change_email", "revert_email"] as const;

/** Jetons à usage unique envoyés par e-mail. Seul le haché SHA-256 est stocké. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: AUTH_TOKEN_PURPOSES }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId, t.purpose)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 (hex) du jeton : le jeton brut n'est jamais stocké.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const DOCUMENT_STATUSES = ["uploaded", "processing", "analyzed", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    pageCount: integer("page_count"),
    /** "text" : texte exploitable ; "vision" : scan/photo à lire visuellement par l'IA. */
    contentMode: text("content_mode", { enum: ["text", "vision"] }).notNull(),
    extractedText: text("extracted_text"),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("uploaded"),
    analysisAttempts: integer("analysis_attempts").notNull().default(0),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    analysis: jsonb("analysis").$type<DocumentAnalysis>(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    // Colonnes dérivées de l'analyse (tri, filtres, tableau de bord)
    title: text("title"),
    category: text("category"),
    docType: text("doc_type"),
    organism: text("organism"),
    documentDate: date("document_date"),
    urgency: text("urgency"),
    amountDue: numeric("amount_due", { precision: 12, scale: 2 }),
    suspicious: boolean("suspicious").notNull().default(false),
    searchVector: tsvector("search_vector"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_user_created_idx").on(t.userId, t.createdAt),
    index("documents_user_status_idx").on(t.userId, t.status),
    index("documents_user_sha_idx").on(t.userId, t.sha256),
    index("documents_search_idx").using("gin", t.searchVector),
  ],
);

export const TASK_STATUSES = ["todo", "done"] as const;

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date"),
    kind: text("kind").notNull().default("action"),
    priority: text("priority", { enum: ["haute", "moyenne", "basse"] }).notNull().default("moyenne"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    source: text("source", { enum: ["ai", "manual"] }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("tasks_user_status_due_idx").on(t.userId, t.status, t.dueDate),
    index("tasks_document_idx").on(t.documentId),
  ],
);

/** Rappels déjà envoyés (un par tâche et par type) : rend l'envoi idempotent, même avec plusieurs instances. */
export const reminderLog = pgTable(
  "reminder_log",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["j7", "j1", "overdue"] }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.kind] })],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // "YYYY-MM"
    analysesUsed: integer("analyses_used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period] })],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // SET NULL : les statistiques de coût survivent à la suppression du compte, sans donnée personnelle.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status", { enum: ["pending", "success", "error", "refused"] }).notNull(),
    errorCode: text("error_code"),
    /** Identifiant de requête du fournisseur (support) et motif d'arrêt : aucun contenu. */
    providerRequestId: text("provider_request_id"),
    stopReason: text("stop_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt), index("ai_calls_user_created_idx").on(t.userId, t.createdAt)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    documentId: uuid("document_id"),
    details: jsonb("details").$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_user_created_idx").on(t.userId, t.createdAt)],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** Événements Stripe déjà traités (idempotence : Stripe peut livrer plusieurs fois le même événement). */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Codes de secours de la double authentification (hachés, usage unique). */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

/** Étape intermédiaire de connexion (mot de passe validé, code de double authentification attendu). */
export const mfaChallenges = pgTable("mfa_challenges", {
  id: text("id").primaryKey(), // haché SHA-256 du jeton remis au navigateur
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Journal des actions d'administration (changement de formule, interrupteurs…).
 * Ne contient aucun contenu de document. L'adresse de l'administrateur est copiée :
 * la trace survit à la suppression de son compte.
 */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id").references(() => users.id, { onDelete: "set null" }),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt)],
);
