import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/server/config";

/**
 * Stockage privé des documents.
 * Chaque fichier est chiffré (AES-256-GCM) avec un IV aléatoire ; la clé de stockage sert de
 * données authentifiées (AAD) : un fichier copié sous un autre chemin ou un autre compte est indéchiffrable.
 * Format : [version=1 (1 octet)][IV (12)][tag (16)][données chiffrées]
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const USER_RE = /^[0-9a-f-]{36}$/;
const VERSION = 1;

export function newStorageKey(userId: string): string {
  return `${userId}/${randomUUID()}`;
}

export function encrypt(key: Buffer, storageKey: string, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(storageKey));
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
}

export function decrypt(key: Buffer, storageKey: string, blob: Buffer): Buffer {
  if (blob.length < 29 || blob[0] !== VERSION) throw new Error("Fichier chiffré invalide");
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(1, 13));
  decipher.setAAD(Buffer.from(storageKey));
  decipher.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
}

export class LocalEncryptedStorage implements StorageDriver {
  constructor(
    private readonly root: string,
    private readonly key: Buffer,
  ) {}

  private filePath(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("Clé de stockage invalide");
    return path.join(this.root, `${key}.bin`);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, encrypt(this.key, key, data), { mode: 0o600 });
    await rename(tmp, file); // écriture atomique
  }

  async get(key: string): Promise<Buffer> {
    return decrypt(this.key, key, await readFile(this.filePath(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(this.filePath(key), { force: true });
  }

  async deleteUser(userId: string): Promise<void> {
    if (!USER_RE.test(userId)) throw new Error("Identifiant invalide");
    await rm(path.join(this.root, userId), { recursive: true, force: true });
  }
}

let instance: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (!instance) {
    const cfg = getConfig();
    instance = new LocalEncryptedStorage(path.resolve(cfg.STORAGE_DIR), cfg.storageKey);
  }
  return instance;
}

export function setStorageForTests(driver: StorageDriver | null): void {
  instance = driver;
}
