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

import * as registerRoute from "@/app/api/auth/register/route";
import { getSetting, parseSettingCommand, setSetting } from "@/server/settings";
import { rateLimits, users } from "@/server/db/schema";
import { apiRequest, upload } from "./helpers";

describe("politique de conservation : chaque règle", () => {
  it("supprime ce qui est ancien, conserve ce qui est récent, ne supprime jamais un compte inactif", async () => {
    const u = await signUp(app);
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 13);
    const recent = new Date(Date.now() - 86_400_000);
    await app.db.insert(aiCalls).values([
      { userId: u.userId, provider: "x", model: "m", estimatedCostUsd: "0.1", costUsd: "0.1", status: "success", createdAt: old },
      { userId: u.userId, provider: "x", model: "m", estimatedCostUsd: "0.1", costUsd: "0.1", status: "success", createdAt: recent },
    ]);
    await app.db.insert(activityLog).values({ userId: u.userId, action: "auth.login", createdAt: recent });
    await app.db.insert(rateLimits).values([
      { key: "test:ancien", windowStart: new Date(Date.now() - 3 * 86_400_000), count: 3 },
      { key: "test:recent", windowStart: new Date(), count: 3 },
    ]);
    // Compte inactif depuis plus de 24 mois
    const inactive = await signUp(app);
    const veryOld = new Date();
    veryOld.setUTCMonth(veryOld.getUTCMonth() - 30);
    await app.db.update(users).set({ createdAt: veryOld, lastLoginAt: veryOld }).where(eq(users.id, inactive.userId));

    const report = await runPurge(app.db, { apply: true });
    expect(report.oldAiCalls).toBe(1);
    expect(report.oldRateLimits).toBe(1);
    expect(report.inactiveAccounts).toBe(1);

    const calls = await app.db.select().from(aiCalls).where(eq(aiCalls.userId, u.userId));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.createdAt.getTime()).toBe(recent.getTime());
    expect(await app.db.select().from(activityLog).where(eq(activityLog.createdAt, recent))).toHaveLength(1);
    expect((await app.db.select().from(rateLimits)).map((r) => r.key)).toContain("test:recent");
    expect((await app.db.select().from(rateLimits)).map((r) => r.key)).not.toContain("test:ancien");
    // Le compte inactif est seulement signalé : sa suppression exige une information préalable.
    expect(await app.db.select().from(users).where(eq(users.id, inactive.userId))).toHaveLength(1);
  });
});

describe("coupe-circuits (kill switches)", () => {
  it("valeurs par défaut actives, modifiables et persistées", async () => {
    expect(await getSetting(app.db, "registrations_enabled")).toBe(true);
    await setSetting(app.db, "registrations_enabled", false);
    expect(await getSetting(app.db, "registrations_enabled")).toBe(false);
    await setSetting(app.db, "registrations_enabled", true);
    expect(await getSetting(app.db, "registrations_enabled")).toBe(true);
  });

  it("registrations_enabled=false ferme les inscriptions (503) sans toucher aux comptes existants", async () => {
    const existing = await signUp(app);
    await setSetting(app.db, "registrations_enabled", false);
    const res = await registerRoute.POST(
      apiRequest("/api/auth/register", { method: "POST", json: { email: "ferme@exemple.fr", password: "Une-Phrase-Solide-42", name: "X", acceptTerms: true } }),
      undefined,
    );
    expect(res.status).toBe(503);
    expect((await upload(existing.token, "a.txt", Buffer.from("toujours possible"))).status).toBe(201);
    await setSetting(app.db, "registrations_enabled", true);
  });

  it("analyse des arguments du script npm run settings", () => {
    expect(parseSettingCommand([])).toEqual({ action: "show" });
    expect(parseSettingCommand(["ai_analysis_enabled", "false"])).toEqual({ action: "set", key: "ai_analysis_enabled", value: false });
    expect(parseSettingCommand(["uploads_enabled", "true"])).toEqual({ action: "set", key: "uploads_enabled", value: true });
    expect(parseSettingCommand(["cle_inconnue", "true"]).action).toBe("error");
    expect(parseSettingCommand(["ai_analysis_enabled", "oui"]).action).toBe("error");
    expect(parseSettingCommand(["ai_analysis_enabled"]).action).toBe("error");
    expect(parseSettingCommand(["__proto__", "true"]).action).toBe("error");
  });
});
