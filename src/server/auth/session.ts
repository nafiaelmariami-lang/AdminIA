import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { getConfig } from "@/server/config";

const SESSION_DAYS = 30;
const RENEW_WHEN_LEFT_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; email: string; name: string; plan: "free" | "essentiel" | "pro"; createdAt: Date };

export function sessionCookieName(): string {
  // Le préfixe __Host- impose Secure, Path=/ et l'absence de Domain : impossible à injecter depuis un sous-domaine.
  return getConfig().NODE_ENV === "production" ? "__Host-adminia_session" : "adminia_session";
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Executor, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function validateSessionToken(db: Executor, token: string | null | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const id = hashToken(token);
  const rows = await db
    .select({
      expiresAt: sessions.expiresAt,
      user: { id: users.id, email: users.email, name: users.name, plan: users.plan, createdAt: users.createdAt },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  // Session glissante : prolongée quand elle approche de l'expiration.
  if (row.expiresAt.getTime() - now < RENEW_WHEN_LEFT_DAYS * DAY_MS) {
    await db.update(sessions).set({ expiresAt: new Date(now + SESSION_DAYS * DAY_MS) }).where(eq(sessions.id, id));
  }
  return row.user;
}

export async function invalidateSession(db: Executor, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function invalidateUserSessions(db: Executor, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(db: Executor): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const secure = getConfig().NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = getConfig().NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export function tokenFromRequest(req: Request): string | null {
  return readCookie(req.headers.get("cookie"), sessionCookieName());
}
