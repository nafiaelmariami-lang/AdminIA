import "server-only";
import { AppError } from "./errors";
import { getConfig } from "./config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: AppError): Response {
  const headers: HeadersInit = err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : {};
  return json({ error: { code: err.code, message: err.message } }, { status: err.status, headers });
}

/**
 * Protection CSRF : les requêtes qui modifient des données doivent venir de notre origine.
 * (Complète le cookie SameSite=Lax.) Les clients non navigateurs n'envoient pas d'Origin.
 */
export function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  const allowed = new Set([new URL(getConfig().APP_URL).origin, new URL(req.url).origin]);
  if (origin) {
    if (!allowed.has(origin)) throw new AppError(403, "bad_origin", "Requête refusée.");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new AppError(403, "bad_origin", "Requête refusée.");
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Enveloppe commune des routes API : CSRF, erreurs métier, erreurs inattendues (sans fuite de détails). */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof AppError) return errorResponse(err);
      console.error("[api] erreur inattendue", req.method, new URL(req.url).pathname, err instanceof Error ? err.message : err);
      return errorResponse(new AppError(500, "internal", "Une erreur inattendue est survenue. Réessayez plus tard."));
    }
  };
}

/** Lit un corps JSON borné (protection contre les corps énormes). */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new AppError(413, "too_large", "Requête trop volumineuse.");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError(413, "too_large", "Requête trop volumineuse.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AppError(400, "invalid_json", "Requête invalide.");
  }
}

/** IP du client, uniquement si l'on se trouve derrière un proxy de confiance. */
export function clientIp(req: Request): string | null {
  if (!getConfig().TRUST_PROXY) return null;
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
