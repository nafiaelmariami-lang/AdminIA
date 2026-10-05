import type { SQL } from "drizzle-orm";
import type { Executor } from "./index";

/** Exécute une requête SQL brute et renvoie ses lignes (node-postgres et PGlite exposent tous deux `rows`). */
export async function queryRows<T>(db: Executor, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}
