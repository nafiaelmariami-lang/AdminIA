import "server-only";
import { and, count, desc, eq, gte, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Executor } from "@/server/db";
import { adminAudit, aiCalls, users } from "@/server/db/schema";
import { queryRows } from "@/server/db/rows";
import { AppError, badRequest, notFound } from "@/server/errors";
import { getConfig } from "@/server/config";
import { log } from "@/server/logger";
import { logActivity } from "@/server/activity";
import { SETTING_DEFAULTS, getSetting, setSetting, type SettingKey } from "@/server/settings";
import { currentPeriod } from "@/server/billing/usage";
import { isBillingEnabled } from "@/server/billing/stripe";
import { isDemoMode } from "@/server/ai/provider";
import { spentTodayUsd } from "@/server/ai/analyze";
import type { SessionUser } from "@/server/auth/session";
import type { PlanId } from "@/lib/plans";

/*
 * Administration : statistiques agrégées, interrupteurs, formules des testeurs.
 * Règle RGPD : aucune fonction de ce module ne lit le contenu, le nom de fichier,
 * le texte extrait ou l'analyse d'un document.
 */

async function audit(db: Executor, admin: SessionUser, action: string, targetUserId: string | null, details: Record<string, string | number | boolean | null>) {
  await db.insert(adminAudit).values({ adminUserId: admin.id, adminEmail: admin.email, action, targetUserId, details });
  log.info("admin.action", { adminId: admin.id, action, targetUserId, ...details });
}

const n = (v: unknown) => Number(v ?? 0);

export async function getAdminOverview(db: Db) {
  const cfg = getConfig();
  const dayAgo = new Date(Date.now() - 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const monthStart = new Date(`${currentPeriod()}-01T00:00:00Z`);

  const [u] = await queryRows<Record<string, string>>(db, sql`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
      count(*) FILTER (WHERE totp_enabled_at IS NOT NULL) AS mfa,
      count(*) FILTER (WHERE created_at >= ${weekAgo.toISOString()}) AS new7d,
      count(*) FILTER (WHERE last_login_at >= ${weekAgo.toISOString()}) AS active7d,
      count(*) FILTER (WHERE plan = 'free') AS free,
      count(*) FILTER (WHERE plan = 'essentiel') AS essentiel,
      count(*) FILTER (WHERE plan = 'pro') AS pro
    FROM users`);
  const [d] = await queryRows<Record<string, string>>(db, sql`
    SELECT count(*) AS total, COALESCE(sum(size_bytes), 0) AS bytes,
      count(*) FILTER (WHERE status = 'analyzed') AS analyzed,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status = 'processing') AS processing,
      count(*) FILTER (WHERE created_at >= ${dayAgo.toISOString()}) AS last24h
    FROM documents`);
  const aiWindow = (since: Date) => queryRows<Record<string, string>>(db, sql`
    SELECT count(*) AS calls,
      count(*) FILTER (WHERE status = 'success') AS success,
      count(*) FILTER (WHERE status IN ('error', 'refused')) AS failed,
      COALESCE(sum(cost_usd), 0) AS cost,
      COALESCE(sum(input_tokens), 0) AS input_tokens,
      COALESCE(sum(output_tokens), 0) AS output_tokens,
      COALESCE(avg(duration_ms) FILTER (WHERE status = 'success'), 0) AS avg_ms
    FROM ai_calls WHERE created_at >= ${since.toISOString()}`);
  const [ai24] = await aiWindow(dayAgo);
  const [aiMonth] = await aiWindow(monthStart);
  const errors = await db
    .select({ code: aiCalls.errorCode, n: count() })
    .from(aiCalls)
    .where(and(gte(aiCalls.createdAt, weekAgo), isNotNull(aiCalls.errorCode)))
    .groupBy(aiCalls.errorCode)
    .orderBy(desc(count()));

  const settings = {} as Record<SettingKey, boolean>;
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) settings[key] = await getSetting(db, key);

  const aiStats = (r: Record<string, string> | undefined) => ({
    calls: n(r?.calls),
    success: n(r?.success),
    failed: n(r?.failed),
    costUsd: n(r?.cost),
    inputTokens: n(r?.input_tokens),
    outputTokens: n(r?.output_tokens),
    avgMs: Math.round(n(r?.avg_ms)),
  });
  return {
    users: { total: n(u?.total), verified: n(u?.verified), mfa: n(u?.mfa), new7d: n(u?.new7d), active7d: n(u?.active7d), byPlan: { free: n(u?.free), essentiel: n(u?.essentiel), pro: n(u?.pro) } },
    documents: { total: n(d?.total), bytes: n(d?.bytes), analyzed: n(d?.analyzed), failed: n(d?.failed), processing: n(d?.processing), last24h: n(d?.last24h) },
    ai: {
      last24h: aiStats(ai24),
      month: aiStats(aiMonth),
      errors7d: errors.map((e) => ({ code: e.code ?? "inconnu", count: Number(e.n) })),
      spentTodayUsd: await spentTodayUsd(db),
      dailyBudgetUsd: cfg.AI_DAILY_BUDGET_USD,
    },
    settings,
    // Configuration non secrète : uniquement des indicateurs, jamais une clé.
    platform: {
      aiProvider: cfg.AI_PROVIDER,
      aiModel: cfg.AI_MODEL,
      aiEnabledByEnv: cfg.AI_ENABLED,
      demoMode: isDemoMode(),
      emailDriver: cfg.EMAIL_DRIVER,
      storageDriver: cfg.STORAGE_DRIVER,
      billingEnabled: isBillingEnabled(cfg),
      emailVerificationRequired: cfg.EMAIL_VERIFICATION_REQUIRED,
    },
  };
}

export type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;

const PAGE_SIZE = 25;

export async function listUsers(db: Db, opts: { q?: string; page?: number } = {}) {
  const page = Math.max(1, Math.min(10_000, Math.floor(opts.page ?? 1)));
  const q = (opts.q ?? "").trim().toLowerCase().slice(0, 254);
  // Recherche par adresse ou nom ; les caractères spéciaux de LIKE sont neutralisés.
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = q ? sql`(${ilike(users.email, pattern)} OR ${ilike(users.name, pattern)})` : undefined;
  const period = currentPeriod();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      emailVerified: sql<boolean>`${users.emailVerifiedAt} IS NOT NULL`,
      mfaEnabled: sql<boolean>`${users.totpEnabledAt} IS NOT NULL`,
      subscriptionStatus: users.subscriptionStatus,
      // Sous-requêtes corrélées : noms qualifiés explicitement (Drizzle n'ajoute pas l'alias de table).
      documents: sql<number>`(SELECT count(*)::int FROM documents d WHERE d.user_id = "users"."id")`,
      storageBytes: sql<number>`(SELECT COALESCE(sum(d.size_bytes), 0)::bigint FROM documents d WHERE d.user_id = "users"."id")`,
      analysesThisMonth: sql<number>`COALESCE((SELECT uc.analyses_used FROM usage_counters uc WHERE uc.user_id = "users"."id" AND uc.period = ${period}), 0)`,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const [{ total }] = (await db.select({ total: count() }).from(users).where(where)) as [{ total: number }];
  return {
    users: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, documents: Number(r.documents), storageBytes: Number(r.storageBytes), analysesThisMonth: Number(r.analysesThisMonth) })),
    page,
    hasMore: rows.length > PAGE_SIZE,
    total: Number(total),
  };
}

const planSchema = z.object({ plan: z.enum(["free", "essentiel", "pro"]), reason: z.string().trim().max(200).optional() });

/**
 * Formule attribuée à la main (testeurs de la bêta). Refusé pour un abonné Stripe :
 * la formule suit alors l'abonnement, sinon le prochain webhook l'écraserait.
 */
export async function setUserPlan(db: Db, admin: SessionUser, userId: string, input: unknown) {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Formule invalide.");
  if (!z.string().uuid().safeParse(userId).success) throw notFound("Compte");
  const [target] = await db.select({ id: users.id, plan: users.plan, subscriptionStatus: users.subscriptionStatus }).from(users).where(eq(users.id, userId));
  if (!target) throw notFound("Compte");
  if (target.subscriptionStatus && ["active", "trialing", "past_due", "incomplete"].includes(target.subscriptionStatus)) {
    throw new AppError(409, "subscription_active", "Ce compte a un abonnement payant : la formule se gère dans Stripe.");
  }
  const plan = parsed.data.plan as PlanId;
  if (target.plan === plan) return { plan };
  await db.transaction(async (tx) => {
    await tx.update(users).set({ plan }).where(eq(users.id, userId));
    await audit(tx, admin, "user.plan_changed", userId, { from: target.plan, to: plan, reason: parsed.data.reason ?? null });
    // Visible par la personne dans son historique : transparence sur l'action de l'équipe.
    await logActivity(tx, userId, "billing.plan_changed", { details: { formule: plan, par: "équipe AdminIA" } });
  });
  return { plan };
}

/**
 * Confirmation manuelle de l'adresse d'un testeur (bêta sans e-mail, support).
 * Ne donne aucun accès au compte ni aux documents ; ne touche pas au mot de passe.
 * Sans effet (et sans trace) si l'adresse est déjà confirmée.
 */
export async function verifyUserEmail(db: Db, admin: SessionUser, userId: string) {
  if (!z.string().uuid().safeParse(userId).success) throw notFound("Compte");
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
      .returning({ id: users.id });
    if (!updated) {
      const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!exists) throw notFound("Compte");
      return { verified: true, alreadyVerified: true };
    }
    await audit(tx, admin, "user.email_verified", userId, {});
    // Visible par la personne dans son historique.
    await logActivity(tx, userId, "account.email_verified", { details: { par: "équipe AdminIA" } });
    return { verified: true, alreadyVerified: false };
  });
}

/**
 * Même confirmation, lancée sur le serveur par l'exploitant (`npm run account:verify-email`).
 * Sert à amorcer le premier administrateur quand les e-mails sont désactivés.
 * Simulation par défaut : rien n'est modifié sans `apply`.
 */
export async function verifyEmailFromCli(db: Db, rawEmail: string, opts: { apply: boolean }) {
  const email = rawEmail.trim().toLowerCase();
  const [u] = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.email, email));
  if (!u) return { found: false as const };
  if (u.emailVerifiedAt || !opts.apply) return { found: true as const, user: u, changed: false };
  await db.transaction(async (tx) => {
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, u.id), isNull(users.emailVerifiedAt)));
    await tx.insert(adminAudit).values({ adminUserId: null, adminEmail: "ligne de commande (serveur)", action: "user.email_verified", targetUserId: u.id, details: {} });
    await logActivity(tx, u.id, "account.email_verified", { details: { par: "équipe AdminIA" } });
  });
  log.info("admin.action", { action: "user.email_verified", via: "cli", targetUserId: u.id });
  return { found: true as const, user: u, changed: true };
}

const settingSchema = z.object({ key: z.enum(Object.keys(SETTING_DEFAULTS) as [SettingKey, ...SettingKey[]]), value: z.boolean() });

export async function updateSetting(db: Db, admin: SessionUser, input: unknown) {
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Réglage inconnu.");
  const { key, value } = parsed.data;
  await setSetting(db, key, value);
  await audit(db, admin, "setting.changed", null, { key, value });
  return { key, value };
}

export async function listAudit(db: Db, limit = 50) {
  return db
    .select({
      id: adminAudit.id,
      adminEmail: adminAudit.adminEmail,
      action: adminAudit.action,
      targetEmail: users.email,
      details: adminAudit.details,
      createdAt: adminAudit.createdAt,
    })
    .from(adminAudit)
    .leftJoin(users, eq(users.id, adminAudit.targetUserId))
    .orderBy(desc(adminAudit.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}
