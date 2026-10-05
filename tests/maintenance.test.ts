import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { activityLog, aiCalls, documents, sessions } from "@/server/db/schema";
import { runPurge } from "@/server/maintenance";
import { setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());

describe("purge de conservation", () => {
  it("simule sans rien modifier, puis applique la politique", async () => {
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "a.txt", Buffer.from("x"));
    await app.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, u.userId));
    await app.db.insert(activityLog).values({ userId: u.userId, action: "auth.login", createdAt: new Date("2020-01-01") });
    await app.db.insert(aiCalls).values({ userId: u.userId, provider: "x", model: "m", estimatedCostUsd: "0.1", status: "pending", createdAt: new Date(Date.now() - 3600_000) });
    await app.db.update(documents).set({ status: "processing", processingStartedAt: new Date(Date.now() - 3600_000) }).where(eq(documents.id, doc.id));
    const orphan = path.join(app.storageDir, "99999999-9999-4999-8999-999999999999");
    await mkdir(orphan, { recursive: true });

    const dry = await runPurge(app.db, { apply: false, storageDir: app.storageDir });
    expect(dry).toMatchObject({ expiredSessions: 1, oldActivity: 1, stalePendingAiCalls: 1, stuckDocuments: 1, applied: false });
    expect(dry.orphanUserDirs).toEqual(["99999999-9999-4999-8999-999999999999"]);
    expect(existsSync(orphan)).toBe(true);

    await runPurge(app.db, { apply: true, storageDir: app.storageDir });
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(path.join(app.storageDir, u.userId))).toBe(true); // fichiers d'un compte existant conservés
    const [d] = await app.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(d!.status).toBe("failed");
    const again = await runPurge(app.db, { apply: false, storageDir: app.storageDir });
    expect(again).toMatchObject({ expiredSessions: 0, oldActivity: 0, stalePendingAiCalls: 0, stuckDocuments: 0, orphanUserDirs: [] });
  });
});
