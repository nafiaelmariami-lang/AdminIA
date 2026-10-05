import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import * as checkoutRoute from "@/app/api/billing/checkout/route";
import * as portalRoute from "@/app/api/billing/portal/route";
import * as webhookRoute from "@/app/api/stripe/webhook/route";
import { users } from "@/server/db/schema";
import { resetConfigForTests } from "@/server/config";
import { setStripeFetchForTests, toForm, verifyStripeSignature } from "@/server/billing/stripe";
import { apiRequest, setupTestApp, signUp, type TestApp } from "./helpers";

const WH = "whsec_test_" + "x".repeat(24);
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_" + "test_" + "y".repeat(24),
  STRIPE_WEBHOOK_SECRET: WH,
  STRIPE_PRICE_ESSENTIEL_MONTHLY: "price_ess_m",
  STRIPE_PRICE_ESSENTIEL_YEARLY: "price_ess_y",
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_pro_y",
};

let app: TestApp;
const calls: { url: string; body: URLSearchParams; headers: Headers }[] = [];
beforeAll(async () => {
  app = await setupTestApp();
  Object.assign(process.env, STRIPE_ENV);
  resetConfigForTests();
  setStripeFetchForTests(async (url, init) => {
    const body = new URLSearchParams(String(init?.body));
    calls.push({ url: String(url), body, headers: new Headers(init?.headers) });
    if (String(url).endsWith("/customers")) return Response.json({ id: `cus_${calls.length}` });
    if (String(url).endsWith("/checkout/sessions")) return Response.json({ url: "https://checkout.stripe.com/c/pay/test" });
    if (String(url).endsWith("/billing_portal/sessions")) return Response.json({ url: "https://billing.stripe.com/p/session/test" });
    return Response.json({ error: { type: "invalid_request_error" } }, { status: 400 });
  });
});
afterAll(async () => {
  for (const k of Object.keys(STRIPE_ENV)) delete process.env[k];
  resetConfigForTests();
  setStripeFetchForTests(null);
  await app.close();
});
afterEach(() => {
  calls.length = 0;
});

const signed = (payload: string, t = Math.floor(Date.now() / 1000), secret = WH) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

function webhook(event: unknown, signature?: string) {
  const payload = JSON.stringify(event);
  return webhookRoute.POST(
    new Request("http://localhost:3000/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signature ?? signed(payload) } }),
    undefined,
  );
}

let eventSeq = 0;
const subEvent = (type: string, sub: Record<string, unknown>, created = Math.floor(Date.now() / 1000)) => ({
  id: `evt_${++eventSeq}_${Date.now()}`,
  type,
  created,
  data: { object: { id: "sub_1", status: "active", cancel_at_period_end: false, items: { data: [{ price: { id: "price_ess_m" }, current_period_end: 1893456000 }] }, ...sub } },
});

const userRow = async (id: string) => (await app.db.select().from(users).where(eq(users.id, id)))[0]!;

describe("paiement : création de session", () => {
  it("crée le client Stripe une seule fois puis une session d'abonnement conforme", async () => {
    const u = await signUp(app);
    const res = await checkoutRoute.POST(apiRequest("/api/billing/checkout", { method: "POST", token: u.token, json: { plan: "pro", interval: "year" } }), undefined);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const customerCall = calls.find((c) => c.url.endsWith("/customers"))!;
    expect(customerCall.headers.get("idempotency-key")).toBe(`customer-${u.userId}`);
    expect(customerCall.headers.get("authorization")).toMatch(/^Bearer sk_test_/);
    const session = calls.find((c) => c.url.endsWith("/checkout/sessions"))!.body;
    expect(session.get("mode")).toBe("subscription");
    expect(session.get("line_items[0][price]")).toBe("price_pro_y");
    expect(session.get("client_reference_id")).toBe(u.userId);
    expect(session.get("subscription_data[metadata][user_id]")).toBe(u.userId);
    expect(session.get("tax_id_collection[enabled]")).toBe("true");
    // La formule n'est PAS modifiée par la création de session (seul le webhook le fait)
    expect((await userRow(u.userId)).plan).toBe("free");

    calls.length = 0;
    await checkoutRoute.POST(apiRequest("/api/billing/checkout", { method: "POST", token: u.token, json: { plan: "essentiel" } }), undefined);
    expect(calls.some((c) => c.url.endsWith("/customers"))).toBe(false);
  });

  it("refuse les formules invalides et la manipulation de champs", async () => {
    const u = await signUp(app);
    const post = (json: unknown) => checkoutRoute.POST(apiRequest("/api/billing/checkout", { method: "POST", token: u.token, json }), undefined);
    expect((await post({ plan: "free" })).status).toBe(400);
    expect((await post({ plan: "entreprise" })).status).toBe(400);
    expect((await post({ plan: "pro", price: "price_0" })).status).toBe(400);
    expect((await post({ plan: "pro", interval: "week" })).status).toBe(400);
    expect((await checkoutRoute.POST(apiRequest("/api/billing/checkout", { method: "POST", json: { plan: "pro" } }), undefined)).status).toBe(401);
  });

  it("un abonné ne peut pas ouvrir un second abonnement (changement via le portail)", async () => {
    const u = await signUp(app);
    await app.db.update(users).set({ plan: "essentiel", subscriptionId: "sub_x", subscriptionStatus: "active" }).where(eq(users.id, u.userId));
    const res = await checkoutRoute.POST(apiRequest("/api/billing/checkout", { method: "POST", token: u.token, json: { plan: "pro" } }), undefined);
    expect(res.status).toBe(409);
  });

  it("portail client : exige un client Stripe existant", async () => {
    const u = await signUp(app);
    expect((await portalRoute.POST(apiRequest("/api/billing/portal", { method: "POST", token: u.token }), undefined)).status).toBe(400);
    await app.db.update(users).set({ billingCustomerId: "cus_portal" }).where(eq(users.id, u.userId));
    const res = await portalRoute.POST(apiRequest("/api/billing/portal", { method: "POST", token: u.token }), undefined);
    expect(((await res.json()) as { url: string }).url).toMatch(/^https:\/\/billing\.stripe\.com\//);
  });
});

describe("paiement : webhooks", () => {
  it("vérification de signature : valide, falsifiée, expirée, mauvais secret, absente", () => {
    const p = '{"a":1}';
    expect(verifyStripeSignature(p, signed(p), WH)).toBe(true);
    expect(verifyStripeSignature('{"a":2}', signed(p), WH)).toBe(false);
    expect(verifyStripeSignature(p, signed(p, Math.floor(Date.now() / 1000) - 3600), WH)).toBe(false);
    expect(verifyStripeSignature(p, signed(p, undefined, "whsec_autre"), WH)).toBe(false);
    expect(verifyStripeSignature(p, null, WH)).toBe(false);
    expect(verifyStripeSignature(p, "t=abc,v1=", WH)).toBe(false);
  });

  it("un webhook non signé ou falsifié est rejeté et ne change rien", async () => {
    const u = await signUp(app);
    await app.db.update(users).set({ billingCustomerId: "cus_fraude" }).where(eq(users.id, u.userId));
    const ev = subEvent("customer.subscription.created", { customer: "cus_fraude", items: { data: [{ price: { id: "price_pro_m" } }] } });
    expect((await webhook(ev, "t=1,v1=deadbeef")).status).toBe(400);
    expect((await userRow(u.userId)).plan).toBe("free");
  });

  it("abonnement créé → formule active ; mis à jour → changement ; supprimé → retour à Découverte", async () => {
    const u = await signUp(app);
    await webhook({ id: `evt_co_${Date.now()}`, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: { client_reference_id: u.userId, customer: "cus_cycle" } } });
    expect((await userRow(u.userId)).billingCustomerId).toBe("cus_cycle");

    const t0 = Math.floor(Date.now() / 1000);
    expect((await webhook(subEvent("customer.subscription.created", { customer: "cus_cycle" }, t0))).status).toBe(200);
    let row = await userRow(u.userId);
    expect(row.plan).toBe("essentiel");
    expect(row.billingInterval).toBe("month");
    expect(row.planRenewsAt?.getTime()).toBe(1893456000 * 1000);

    await webhook(subEvent("customer.subscription.updated", { customer: "cus_cycle", items: { data: [{ price: { id: "price_pro_y" }, current_period_end: 1900000000 }] }, cancel_at_period_end: true }, t0 + 10));
    row = await userRow(u.userId);
    expect(row.plan).toBe("pro");
    expect(row.billingInterval).toBe("year");
    expect(row.cancelAtPeriodEnd).toBe(true);

    await webhook(subEvent("customer.subscription.updated", { customer: "cus_cycle", status: "past_due" }, t0 + 20));
    expect((await userRow(u.userId)).plan).toBe("essentiel"); // délai de grâce pendant les relances

    await webhook(subEvent("customer.subscription.deleted", { customer: "cus_cycle", status: "canceled" }, t0 + 30));
    row = await userRow(u.userId);
    expect(row.plan).toBe("free");
    expect(row.subscriptionId).toBeNull();
  });

  it("idempotence : un événement livré deux fois n'est appliqué qu'une fois", async () => {
    const u = await signUp(app);
    await app.db.update(users).set({ billingCustomerId: "cus_idem" }).where(eq(users.id, u.userId));
    const ev = subEvent("customer.subscription.created", { customer: "cus_idem" });
    const first = (await (await webhook(ev)).json()) as { result: string };
    const second = (await (await webhook(ev)).json()) as { result: string };
    expect(first.result).toBe("processed");
    expect(second.result).toBe("duplicate");
  });

  it("un événement plus ancien arrivé en retard n'écrase pas l'état récent", async () => {
    const u = await signUp(app);
    await app.db.update(users).set({ billingCustomerId: "cus_ordre" }).where(eq(users.id, u.userId));
    const t = Math.floor(Date.now() / 1000);
    await webhook(subEvent("customer.subscription.deleted", { customer: "cus_ordre", status: "canceled" }, t));
    await webhook(subEvent("customer.subscription.updated", { customer: "cus_ordre" }, t - 60));
    expect((await userRow(u.userId)).plan).toBe("free");
  });

  it("prix inconnu : aucune formule attribuée ; client inconnu : ignoré sans erreur", async () => {
    const u = await signUp(app);
    await app.db.update(users).set({ billingCustomerId: "cus_prix" }).where(eq(users.id, u.userId));
    await webhook(subEvent("customer.subscription.created", { customer: "cus_prix", items: { data: [{ price: { id: "price_inconnu" } }] } }));
    expect((await userRow(u.userId)).plan).toBe("free");
    expect((await webhook(subEvent("customer.subscription.created", { customer: "cus_personne" }))).status).toBe(200);
  });
});

describe("suppression de compte d'un abonné", () => {
  it("résilie l'abonnement Stripe avant d'effacer le compte ; refuse d'effacer si la résiliation échoue", async () => {
    const accountRoute = await import("@/app/api/account/route");
    const u = await signUp(app);
    await app.db.update(users).set({ plan: "pro", billingCustomerId: "cus_del", subscriptionId: "sub_del", subscriptionStatus: "active" }).where(eq(users.id, u.userId));
    const del = () => accountRoute.DELETE(apiRequest("/api/account", { method: "DELETE", token: u.token, json: { password: u.password, confirm: "SUPPRIMER" } }), undefined);

    setStripeFetchForTests(async () => new Response("{}", { status: 500 }));
    expect((await del()).status).toBe(503);
    expect(await app.db.select().from(users).where(eq(users.id, u.userId))).toHaveLength(1); // rien n'est effacé

    const deletes: string[] = [];
    setStripeFetchForTests(async (url, init) => {
      deletes.push(`${init?.method} ${String(url)}`);
      return Response.json({ id: "sub_del", status: "canceled" });
    });
    expect((await del()).status).toBe(200);
    expect(deletes).toEqual(["DELETE https://api.stripe.com/v1/subscriptions/sub_del"]);
    expect(await app.db.select().from(users).where(eq(users.id, u.userId))).toHaveLength(0);
  });
});

describe("paiement désactivé (aucune clé)", () => {
  it("création de session et portail renvoient 503, le webhook est introuvable", async () => {
    for (const k of Object.keys(STRIPE_ENV)) delete process.env[k];
    resetConfigForTests();
    const u = await signUp(app);
    expect((await checkoutRoute.POST(apiRequest("/api/billing/checkout", { method: "POST", token: u.token, json: { plan: "pro" } }), undefined)).status).toBe(503);
    expect((await portalRoute.POST(apiRequest("/api/billing/portal", { method: "POST", token: u.token }), undefined)).status).toBe(503);
    expect((await webhook({ id: "evt_x", type: "x", created: 1, data: { object: {} } })).status).toBe(404);
    Object.assign(process.env, STRIPE_ENV);
    resetConfigForTests();
  });

  it("encodage des paramètres imbriqués au format Stripe", () => {
    const f = toForm({ a: 1, b: { c: "x", d: [{ e: true }] }, n: null });
    expect(f.toString()).toBe("a=1&b%5Bc%5D=x&b%5Bd%5D%5B0%5D%5Be%5D=true");
  });
});
