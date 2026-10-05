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
    // Champs prêts pour l'intégration Stripe (non utilisés tant que le paiement n'est pas activé).
    billingCustomerId: text("billing_customer_id"),
    planRenewsAt: timestamp("plan_renews_at", { withTimezone: true }),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
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
