import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { sessionCookieName, validateSessionToken, type SessionUser } from "./session";

/** Pages serveur : utilisateur courant ou null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  return validateSessionToken(await getDb(), token);
}

/** Pages serveur protégées : redirige vers la connexion si besoin. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  return user;
}
