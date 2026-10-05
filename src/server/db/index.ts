import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { getConfig } from "@/server/config";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** Base ou transaction : les services acceptent les deux. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

type DbHolder = { db?: Db; ready?: Promise<Db>; close?: () => Promise<void> };
const holder = ((globalThis as Record<string, unknown>).__adminiaDb ??= {}) as DbHolder;

async function createPglite(dataDir: string | undefined): Promise<{ db: Db; close: () => Promise<void> }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Db;
  // En dev/test, les migrations sont appliquées automatiquement.
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => client.close() };
}

async function createPostgres(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, close: () => pool.end() };
}

/** Connexion unique (réutilisée entre les rechargements à chaud en dev). */
export async function getDb(): Promise<Db> {
  if (holder.db) return holder.db;
  holder.ready ??= (async () => {
    const url = getConfig().DATABASE_URL;
    const conn = url.startsWith("pglite:")
      ? await createPglite(url === "pglite:memory" ? undefined : url.replace(/^pglite:\/\//, ""))
      : await createPostgres(url);
    holder.db = conn.db;
    holder.close = conn.close;
    return conn.db;
  })();
  return holder.ready;
}

/** Tests : base PGlite neuve, en mémoire, migrée. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  return createPglite(undefined);
}

/** Tests : injecte une base. */
export function setDbForTests(db: Db | undefined): void {
  holder.db = db;
  holder.ready = db ? Promise.resolve(db) : undefined;
}

export { schema };
