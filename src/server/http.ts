import "server-only";
import { log } from "@/server/logger";
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
      log.error("api.unexpected_error", { method: req.method, path: new URL(req.url).pathname, error: err });
      return errorResponse(new AppError(500, "internal", "Une erreur inattendue est survenue. Réessayez plus tard."));
    }
  };
}

/**
 * Lit le corps de la requête en comptant les octets et s'ARRÊTE dès que la limite est dépassée,
 * même sans en-tête Content-Length (envoi « chunked ») : la mémoire consommée reste bornée.
 */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError(413, "too_large", "Fichier trop volumineux.");
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AppError(413, "too_large", "Fichier trop volumineux.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Lit un formulaire multipart borné en taille. */
export async function readFormLimited(req: Request, maxBytes: number): Promise<FormData> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) throw new AppError(400, "invalid_form", "Envoi invalide.");
  const bytes = await readBodyLimited(req, maxBytes);
  try {
    return await new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new AppError(400, "invalid_form", "Envoi invalide.");
  }
}

/** Lit un corps JSON borné (protection contre les corps énormes). */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = new TextDecoder().decode(await readBodyLimited(req, maxBytes));
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
