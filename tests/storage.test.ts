import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { LocalEncryptedStorage, S3EncryptedStorage, setStorageForTests, StorageError, type StorageDriver } from "@/server/storage";
import * as fileRoute from "@/app/api/documents/[id]/file/route";
import * as docRoute from "@/app/api/documents/[id]/route";
import * as exportRoute from "@/app/api/account/export/route";
import * as accountRoute from "@/app/api/account/route";
import { runPurge } from "@/server/maintenance";
import { apiRequest, ctx, setupTestApp, signUp, uploadOk, type TestApp } from "./helpers";
import { makePdf } from "./fixtures";
import { createFakeS3 } from "./fake-s3";

const key = randomBytes(32);
let localDir: string;

beforeAll(async () => {
  localDir = await mkdtemp(path.join(tmpdir(), "adminia-storage-"));
});
afterAll(async () => rm(localDir, { recursive: true, force: true }));

const makeS3 = (fake = createFakeS3()) =>
  new S3EncryptedStorage({ endpoint: "https://s3.exemple.test", region: "fr-par", bucket: "adminia-test", accessKeyId: "AKTEST", secretAccessKey: "secret", prefix: "test/", fetchImpl: fake.fetchImpl }, key);

const drivers: [string, () => StorageDriver][] = [
  ["local", () => new LocalEncryptedStorage(localDir, key)],
  ["s3", () => makeS3()],
];

describe.each(drivers)("contrat du pilote de stockage « %s »", (_name, make) => {
  const user = randomUUID();
  const k1 = `${user}/${randomUUID()}`;
  const k2 = `${user}/${randomUUID()}`;
  const k3 = `${user}/${randomUUID()}`;
  let s: StorageDriver;
  beforeAll(() => {
    s = make();
  });

  it("écrit, relit à l'identique, supprime", async () => {
    await s.put(k1, Buffer.from("contenu secret"));
    expect((await s.get(k1)).toString()).toBe("contenu secret");
    await s.delete(k1);
    await expect(s.get(k1)).rejects.toThrow();
    await s.delete(k1); // supprimer un fichier absent n'échoue pas
  });

  it("supprime tous les fichiers d'un compte (pagination comprise) et les liste", async () => {
    await s.put(k1, Buffer.from("1"));
    await s.put(k2, Buffer.from("2"));
    await s.put(k3, Buffer.from("3"));
    expect(await s.listUserIds()).toContain(user);
    await s.deleteUser(user);
    expect(await s.listUserIds()).not.toContain(user);
    for (const k of [k1, k2, k3]) await expect(s.get(k)).rejects.toThrow();
  });

  it("refuse les clés malformées (traversée de chemin, injection)", async () => {
    for (const bad of ["../../etc/passwd", `${user}/../x`, "a/b", `${user}/${randomUUID()}?x=1`]) {
      await expect(s.put(bad, Buffer.from("x"))).rejects.toBeInstanceOf(StorageError);
      await expect(s.get(bad)).rejects.toBeInstanceOf(StorageError);
    }
    await expect(s.deleteUser("../..")).rejects.toBeInstanceOf(StorageError);
  });
});

describe("stockage objet S3 : sécurité", () => {
  it("le fournisseur ne reçoit que des données chiffrées, toujours via des requêtes signées", async () => {
    const fake = createFakeS3();
    const s = makeS3(fake);
    const k = `${randomUUID()}/${randomUUID()}`;
    await s.put(k, Buffer.from("IBAN FR76 1234 confidentiel"));
    const stored = [...fake.objects.values()][0]!;
    expect(Buffer.from(stored).includes(Buffer.from("confidentiel"))).toBe(false);
    expect(fake.unsignedCount()).toBe(0);
    expect([...fake.objects.keys()][0]).toBe(`test/${k}.bin`);
  });

  it("une altération côté fournisseur est détectée au déchiffrement", async () => {
    const fake = createFakeS3();
    const s = makeS3(fake);
    const k = `${randomUUID()}/${randomUUID()}`;
    await s.put(k, Buffer.from("original"));
    const stored = [...fake.objects.values()][0]!;
    stored[stored.length - 1]! ^= 1;
    await expect(s.get(k)).rejects.toThrow();
  });

  it("erreurs réseau et refus du fournisseur traduits en StorageError", async () => {
    const down = new S3EncryptedStorage(
      { endpoint: "https://s3.exemple.test", region: "fr-par", bucket: "b", accessKeyId: "a", secretAccessKey: "s", fetchImpl: async () => { throw new TypeError("fetch failed"); } },
      key,
    );
    await expect(down.put(`${randomUUID()}/${randomUUID()}`, Buffer.from("x"))).rejects.toBeInstanceOf(StorageError);
    const denied = new S3EncryptedStorage(
      { endpoint: "https://s3.exemple.test", region: "fr-par", bucket: "b", accessKeyId: "a", secretAccessKey: "s", fetchImpl: async () => new Response("", { status: 403 }) },
      key,
    );
    await expect(denied.get(`${randomUUID()}/${randomUUID()}`)).rejects.toThrow(/403/);
    expect(() => new S3EncryptedStorage({ endpoint: "https://x", region: "r", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "../" }, key)).toThrow();
  });
});

describe("application complète sur stockage objet S3", () => {
  let app: TestApp;
  const fake = createFakeS3();
  beforeAll(async () => {
    app = await setupTestApp();
    setStorageForTests(makeS3(fake));
  });
  afterAll(async () => app.close());

  it("ajout, téléchargement, export, suppression de document et de compte, purge des orphelins", async () => {
    const u = await signUp(app);
    const pdf = makePdf([["Document stocke sur S3"]]);
    const doc = await uploadOk(u.token, "s3.pdf", pdf);
    expect(fake.objects.size).toBe(1);
    const file = await fileRoute.GET(apiRequest(`/api/documents/${doc.id}/file`, { token: u.token }), ctx(doc.id));
    expect(Buffer.from(await file.arrayBuffer()).equals(pdf)).toBe(true);
    const zip = unzipSync(new Uint8Array(await (await exportRoute.GET(apiRequest("/api/account/export", { token: u.token }), undefined)).arrayBuffer()));
    expect(Object.keys(zip).some((n) => n.endsWith("s3.pdf"))).toBe(true);
    await docRoute.DELETE(apiRequest(`/api/documents/${doc.id}`, { method: "DELETE", token: u.token }), ctx(doc.id));
    expect(fake.objects.size).toBe(0);

    await uploadOk(u.token, "a.txt", Buffer.from("a"));
    await uploadOk(u.token, "b.txt", Buffer.from("b"));
    await uploadOk(u.token, "c.txt", Buffer.from("c"));
    expect(fake.objects.size).toBe(3);
    const del = await accountRoute.DELETE(apiRequest("/api/account", { method: "DELETE", token: u.token, json: { password: u.password, confirm: "SUPPRIMER" } }), undefined);
    expect(del.status).toBe(200);
    expect(fake.objects.size).toBe(0);

    // Fichiers orphelins (compte supprimé hors application) : détectés puis purgés
    const orphan = randomUUID();
    fake.objects.set(`test/${orphan}/${randomUUID()}.bin`, new Uint8Array([1]));
    const report = await runPurge(app.db, { apply: true });
    expect(report.orphanUserDirs).toEqual([orphan]);
    expect(fake.objects.size).toBe(0);
  });
});
