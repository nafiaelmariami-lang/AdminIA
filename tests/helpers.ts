import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createTestDb, setDbForTests, type Db } from "@/server/db";
import { LocalEncryptedStorage, setStorageForTests } from "@/server/storage";
import { setAiProviderForTests } from "@/server/ai/provider";
import { setEmailSenderForTests, type EmailMessage, type EmailSender } from "@/server/email";
import { resetConfigForTests } from "@/server/config";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import * as registerRoute from "@/app/api/auth/register/route";
import * as documentsRoute from "@/app/api/documents/route";

export const ORIGIN = "http://localhost:3000";

export type TestApp = { db: Db; storageDir: string; close: () => Promise<void> };

export async function setupTestApp(): Promise<TestApp> {
  resetConfigForTests();
  const { db, close } = await createTestDb();
  setDbForTests(db);
  const storageDir = await mkdtemp(path.join(tmpdir(), "adminia-test-"));
  setStorageForTests(new LocalEncryptedStorage(storageDir, randomBytes(32)));
  setAiProviderForTests(null);
  setEmailSenderForTests(memoryEmail);
  memoryEmail.sent.length = 0;
  return {
    db,
    storageDir,
    close: async () => {
      setDbForTests(undefined);
      setStorageForTests(null);
      setAiProviderForTests(null);
      await close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

type ReqOpts = { method?: string; token?: string | null; json?: unknown; form?: FormData; origin?: string | null; headers?: Record<string, string> };

export function apiRequest(pathname: string, opts: ReqOpts = {}): Request {
  const headers = new Headers(opts.headers);
  if (opts.origin !== null) headers.set("origin", opts.origin ?? ORIGIN);
  if (opts.token) headers.set("cookie", `adminia_session=${opts.token}`);
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers.set("content-type", "application/json");
  } else if (opts.form) body = opts.form;
  return new Request(`${ORIGIN}${pathname}`, { method: opts.method ?? "GET", headers, body });
}

export const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

export function tokenFrom(res: Response): string | null {
  const cookie = res.headers.get("set-cookie") ?? "";
  return /adminia_session=([^;]*)/.exec(cookie)?.[1] || null;
}

let counter = 0;
export async function signUp(app: TestApp, opts: { email?: string; plan?: "free" | "essentiel" | "pro"; password?: string; verified?: boolean } = {}) {
  const email = opts.email ?? `user${++counter}-${Date.now()}@exemple.fr`;
  const password = opts.password ?? "Un-Mot-De-Passe-Solide-42";
  const res = await registerRoute.POST(apiRequest("/api/auth/register", { method: "POST", json: { email, password, name: "Test", acceptTerms: true } }), undefined);
  if (res.status !== 201) throw new Error(`inscription échouée : ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { userId: string };
  if (opts.plan && opts.plan !== "free") await app.db.update(users).set({ plan: opts.plan }).where(eq(users.id, body.userId));
  // Adresse confirmée par défaut (les tests du parcours de confirmation passent verified: false).
  if (opts.verified !== false) await app.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, body.userId));
  return { token: tokenFrom(res)!, userId: body.userId, email, password };
}

export async function upload(token: string, name: string, bytes: Buffer): Promise<Response> {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  return documentsRoute.POST(apiRequest("/api/documents", { method: "POST", token, form }), undefined);
}

export async function uploadOk(token: string, name: string, bytes: Buffer): Promise<{ id: string; status: string; [k: string]: unknown }> {
  const res = await upload(token, name, bytes);
  if (res.status !== 201 && res.status !== 200) throw new Error(`upload échoué : ${res.status} ${await res.text()}`);
  return ((await res.json()) as { document: { id: string; status: string } }).document;
}

/** Boîte e-mail en mémoire pour les tests. */
export const memoryEmail: EmailSender & { sent: EmailMessage[]; fail: boolean; lastTo(to: string): EmailMessage | undefined } = {
  name: "memoire",
  sent: [],
  fail: false,
  async send(m: EmailMessage) {
    if (this.fail) throw new Error("panne simulée");
    this.sent.push(m);
  },
  lastTo(to: string) {
    return [...this.sent].reverse().find((m) => m.to === to);
  },
};

/** Extrait le jeton d'un lien contenu dans un e-mail. */
export function tokenFromEmail(m: EmailMessage | undefined): string {
  const t = /token=([A-Za-z0-9_-]+)/.exec(m?.text ?? "")?.[1];
  if (!t) throw new Error("aucun lien dans l'e-mail");
  return t;
}
