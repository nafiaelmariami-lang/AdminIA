/**
 * Applique les migrations SQL (dossier ./drizzle) sur DATABASE_URL.
 * Usage : npm run db:migrate
 */
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant");
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite(url.replace(/^pglite:\/\//, ""));
    await migrate(drizzle(client), { migrationsFolder });
    await client.close();
  } else {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle(pool), { migrationsFolder });
    await pool.end();
  }
  console.log("Migrations appliquées.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
