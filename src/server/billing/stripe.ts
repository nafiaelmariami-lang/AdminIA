import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { stripeEvents, users } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import { getConfig, type AppConfig } from "@/server/config";
import { log } from "@/server/logger";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import type { PlanId } from "@/lib/plans";

/**
 * Intégration Stripe (abonnements) par appels HTTP directs, sans SDK.
 *
 * Principe de sécurité : la formule d'un utilisateur n'est JAMAIS modifiée à partir d'une
 * information venant du navigateur. Seuls les webhooks Stripe, dont la signature HMAC est
 * vérifiée, mettent à jour `users.plan`.
 */

const STRIPE_API = "https://api.stripe.com/v1";
const WEBHOOK_TOLERANCE_SEC = 300;

export type Interval = "month" | "year";

let fetchOverride: typeof fetch | null = null;
export function setStripeFetchForTests(f: typeof fetch | null): void {
  fetchOverride = f;
}

export function isBillingEnabled(cfg: AppConfig = getConfig()): boolean {
  return Boolean(cfg.STRIPE_SECRET_KEY && cfg.STRIPE_WEBHOOK_SECRET && cfg.STRIPE_PRICE_ESSENTIEL_MONTHLY && cfg.STRIPE_PRICE_PRO_MONTHLY);
}

/** Correspondance prix Stripe ↔ formule, issue de la configuration. */
export function priceMap(cfg: AppConfig = getConfig()): { price: string; plan: Exclude<PlanId, "free">; interval: Interval }[] {
  const entries: [string | undefined, Exclude<PlanId, "free">, Interval][] = [
    [cfg.STRIPE_PRICE_ESSENTIEL_MONTHLY, "essentiel", "month"],
    [cfg.STRIPE_PRICE_ESSENTIEL_YEARLY, "essentiel", "year"],
    [cfg.STRIPE_PRICE_PRO_MONTHLY, "pro", "month"],
    [cfg.STRIPE_PRICE_PRO_YEARLY, "pro", "year"],
  ];
  return entries.filter((e): e is [string, Exclude<PlanId, "free">, Interval] => !!e[0]).map(([price, plan, interval]) => ({ price, plan, interval }));
}

/** Encodage « form » imbriqué attendu par l'API Stripe (a[b][c]=v). */
export function toForm(params: Record<string, unknown>, prefix = ""): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, key ? `${key}[${k}]` : k);
    else out.append(key, String(value));
  };
  walk(params, prefix);
  return out;
}

async function stripeRequest<T>(path: string, params: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = getConfig().STRIPE_SECRET_KEY;
  if (!key) throw new AppError(503, "billing_disabled", "Le paiement en ligne n'est pas encore disponible.");
  let res: Response;
  try {
    res = await (fetchOverride ?? fetch)(`${STRIPE_API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: toForm(params).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppError(503, "billing_unavailable", "Le service de paiement est momentanément indisponible.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; type?: string } };
  if (!res.ok) {
    log.error("billing.stripe_error", { path, status: res.status, type: body.error?.type });
    throw new AppError(502, "billing_error", "Le service de paiement a refusé la demande. Réessayez plus tard.");
  }
  return body;
}

const checkoutSchema = z.object({ plan: z.enum(["essentiel", "pro"]), interval: z.enum(["month", "year"]).default("month") }).strict();

async function ensureCustomer(db: Executor, user: { id: string; email: string; name: string }): Promise<string> {
  const [row] = await db.select({ customer: users.billingCustomerId }).from(users).where(eq(users.id, user.id));
  if (row?.customer) return row.customer;
  const customer = await stripeRequest<{ id: string }>(
    "/customers",
    { email: user.email, name: user.name, metadata: { user_id: user.id }, preferred_locales: ["fr"] },
    `customer-${user.id}`,
  );
  // Ne remplace jamais un client déjà enregistré par une requête concurrente.
  await db.update(users).set({ billingCustomerId: customer.id }).where(and(eq(users.id, user.id), isNull(users.billingCustomerId)));
  const [after] = await db.select({ customer: users.billingCustomerId }).from(users).where(eq(users.id, user.id));
  return after!.customer!;
}

/** Crée une session de paiement Stripe Checkout et renvoie son URL. */
export async function createCheckoutSession(db: Executor, user: { id: string; email: string; name: string }, input: unknown): Promise<string> {
  const cfg = getConfig();
  if (!isBillingEnabled(cfg)) throw new AppError(503, "billing_disabled", "Le paiement en ligne n'est pas encore disponible.");
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Formule invalide.");
  const { plan, interval } = parsed.data;
  const price = priceMap(cfg).find((p) => p.plan === plan && p.interval === interval)?.price;
  if (!price) throw badRequest("Cette périodicité n'est pas disponible pour cette formule.");
  await enforceRateLimit(db, `checkout:${user.id}`, 10, 3600, "Trop de tentatives. Réessayez plus tard.");
  const [current] = await db.select({ subscriptionId: users.subscriptionId, status: users.subscriptionStatus }).from(users).where(eq(users.id, user.id));
  if (current?.subscriptionId && current.status && ACTIVE_STATUSES.has(current.status)) {
    throw new AppError(409, "already_subscribed", "Vous avez déjà un abonnement : changez de formule depuis « Gérer mon abonnement ».");
  }

  const customer = await ensureCustomer(db, user);
  const appUrl = cfg.APP_URL.replace(/\/$/, "");
  const session = await stripeRequest<{ url: string }>("/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl}/app/compte?paiement=ok`,
    cancel_url: `${appUrl}/app/compte?paiement=annule`,
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    locale: "fr",
    ...(cfg.STRIPE_AUTOMATIC_TAX ? { automatic_tax: { enabled: true } } : {}),
  });
  return session.url;
}

/** Portail client Stripe : changer de formule, moyen de paiement, factures, résiliation. */
export async function createPortalSession(db: Executor, userId: string): Promise<string> {
  if (!isBillingEnabled()) throw new AppError(503, "billing_disabled", "Le paiement en ligne n'est pas encore disponible.");
  const [row] = await db.select({ customer: users.billingCustomerId }).from(users).where(eq(users.id, userId));
  if (!row?.customer) throw badRequest("Aucun abonnement à gérer.", "no_customer");
  const session = await stripeRequest<{ url: string }>("/billing_portal/sessions", {
    customer: row.customer,
    return_url: `${getConfig().APP_URL.replace(/\/$/, "")}/app/compte`,
  });
  return session.url;
}

// ─────────────────────────────────────────────────────────────
// Webhooks
// ─────────────────────────────────────────────────────────────

/** Vérifie l'en-tête Stripe-Signature (HMAC-SHA256 de « t.payload »), avec tolérance d'horodatage. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowSec - t) > WEBHOOK_TOLERANCE_SEC) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}

type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
};

type StripeEvent = { id: string; type: string; created: number; data: { object: Record<string, unknown> } };

/** Statuts qui donnent accès à la formule payante (past_due : délai de grâce pendant les relances). */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

async function applySubscription(db: Executor, sub: StripeSubscription, eventAt: Date, deleted: boolean): Promise<void> {
  const item = sub.items?.data?.[0];
  const mapping = priceMap().find((p) => p.price === item?.price?.id);
  const active = !deleted && ACTIVE_STATUSES.has(sub.status);
  if (active && !mapping) {
    log.error("billing.unknown_price", { subscription: sub.id, price: item?.price?.id ?? null });
    return;
  }
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const plan: PlanId = active ? mapping!.plan : "free";

  // Utilisateur retrouvé par le client Stripe (ou, à défaut, par la métadonnée posée à la création).
  const userIdFromMeta = sub.metadata?.user_id;
  const where = or(eq(users.billingCustomerId, sub.customer), userIdFromMeta && /^[0-9a-f-]{36}$/.test(userIdFromMeta) ? eq(users.id, userIdFromMeta) : sql`false`);
  const updated = await db
    .update(users)
    .set({
      plan,
      billingCustomerId: sub.customer,
      subscriptionId: deleted ? null : sub.id,
      subscriptionStatus: deleted ? "canceled" : sub.status,
      billingInterval: active ? mapping!.interval : null,
      planRenewsAt: active && periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: !deleted && Boolean(sub.cancel_at_period_end),
      billingEventAt: eventAt,
    })
    // Un événement plus ancien que le dernier appliqué est ignoré (livraison dans le désordre).
    .where(and(where, or(isNull(users.billingEventAt), lt(users.billingEventAt, eventAt))))
    .returning({ id: users.id, plan: users.plan });
  for (const u of updated) await logActivity(db, u.id, "billing.plan_changed", { details: { formule: u.plan, statut: deleted ? "canceled" : sub.status } });
  if (updated.length === 0) log.info("billing.event_skipped", { subscription: sub.id, reason: "stale_or_unknown_customer" });
}

/** Traite un événement Stripe vérifié. Idempotent : un même événement n'est appliqué qu'une fois. */
export async function handleStripeEvent(db: Executor, event: StripeEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const inserted = await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: stripeEvents.id });
  if (inserted.length === 0) return "duplicate";
  const eventAt = new Date(event.created * 1000);
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const userId = typeof obj.client_reference_id === "string" ? obj.client_reference_id : null;
      const customer = typeof obj.customer === "string" ? obj.customer : null;
      if (userId && customer && /^[0-9a-f-]{36}$/.test(userId)) {
        await db.update(users).set({ billingCustomerId: customer }).where(and(eq(users.id, userId), isNull(users.billingCustomerId)));
      }
      return "processed";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await applySubscription(db, obj as unknown as StripeSubscription, eventAt, false);
      return "processed";
    case "customer.subscription.deleted":
      await applySubscription(db, obj as unknown as StripeSubscription, eventAt, true);
      return "processed";
    case "invoice.payment_failed":
      log.warn("billing.payment_failed", { customer: typeof obj.customer === "string" ? obj.customer : null });
      return "processed";
    default:
      return "ignored";
  }
}

export async function processWebhook(db: Executor, payload: string, signature: string | null): Promise<string> {
  const secret = getConfig().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new AppError(404, "not_found", "Ressource introuvable.");
  if (!verifyStripeSignature(payload, signature, secret)) throw new AppError(400, "bad_signature", "Signature invalide.");
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    throw new AppError(400, "invalid_json", "Événement invalide.");
  }
  if (!event?.id || !event.type || !event.data?.object) throw new AppError(400, "invalid_event", "Événement invalide.");
  return handleStripeEvent(db, event);
}
