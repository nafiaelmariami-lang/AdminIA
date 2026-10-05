import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { getConfig } from "@/server/config";

/**
 * Stockage privé des documents.
 *
 * Chaque fichier est chiffré PAR L'APPLICATION (AES-256-GCM, IV aléatoire) avant d'être confié au
 * stockage : ni l'hébergeur du disque ni le fournisseur de stockage objet ne peuvent le lire.
 * La clé de stockage sert de données authentifiées (AAD) : un fichier copié sous un autre chemin
 * ou vers un autre compte devient indéchiffrable.
 * Format : [version=1 (1 octet)][IV (12)][tag (16)][données chiffrées]
 *
 * Deux pilotes :
 *  - « local » : disque local (développement, ou un seul serveur avec volume persistant) ;
 *  - « s3 »    : stockage objet compatible S3 (Scaleway, OVH, Cloudflare R2, MinIO…), nécessaire
 *                dès qu'il y a plusieurs instances applicatives.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /** Identifiants des comptes ayant des fichiers (détection des fichiers orphelins). */
  listUserIds(): Promise<string[]>;
}

export class StorageError extends Error {}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const USER_RE = /^[0-9a-f-]{36}$/;
const VERSION = 1;

export function newStorageKey(userId: string): string {
  return `${userId}/${randomUUID()}`;
}

function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new StorageError("Clé de stockage invalide");
}
function assertUser(userId: string): void {
  if (!USER_RE.test(userId)) throw new StorageError("Identifiant invalide");
}

export function encrypt(key: Buffer, storageKey: string, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(storageKey));
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
}

export function decrypt(key: Buffer, storageKey: string, blob: Buffer): Buffer {
  if (blob.length < 29 || blob[0] !== VERSION) throw new StorageError("Fichier chiffré invalide");
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(1, 13));
  decipher.setAAD(Buffer.from(storageKey));
  decipher.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
}

// ─────────────────────────────────────────────────────────────
// Disque local
// ─────────────────────────────────────────────────────────────

export class LocalEncryptedStorage implements StorageDriver {
  readonly name = "local";
  constructor(
    private readonly root: string,
    private readonly key: Buffer,
  ) {}

  private filePath(key: string): string {
    assertKey(key);
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
    assertUser(userId);
    await rm(path.join(this.root, userId), { recursive: true, force: true });
  }

  async listUserIds(): Promise<string[]> {
    const entries = await readdir(this.root).catch(() => [] as string[]);
    return entries.filter((e) => USER_RE.test(e));
  }
}

// ─────────────────────────────────────────────────────────────
// Stockage objet compatible S3 (signature AWS SigV4, adressage par chemin)
// ─────────────────────────────────────────────────────────────

export type S3Options = {
  endpoint: string; // ex. https://s3.fr-par.scw.cloud
  region: string; // ex. fr-par
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Préfixe facultatif (ex. « production/ ») pour partager un bucket entre environnements. */
  prefix?: string;
  fetchImpl?: typeof fetch;
};

const S3_TIMEOUT_MS = 30_000;

const xmlValues = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((m) => m[1]!);

export class S3EncryptedStorage implements StorageDriver {
  readonly name = "s3";
  private readonly client: AwsClient;
  private readonly base: string;
  private readonly prefix: string;

  constructor(
    private readonly opts: S3Options,
    private readonly key: Buffer,
  ) {
    this.client = new AwsClient({ accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, region: opts.region, service: "s3" });
    this.base = `${opts.endpoint.replace(/\/$/, "")}/${encodeURIComponent(opts.bucket)}`;
    this.prefix = (opts.prefix ?? "").replace(/^\/+/, "");
    if (this.prefix && !/^[a-z0-9-]+\/$/.test(this.prefix)) throw new StorageError("Préfixe S3 invalide (ex. « production/ »).");
  }

  private async send(url: string, init: RequestInit = {}): Promise<Response> {
    const signed = await this.client.sign(url, { ...init, signal: AbortSignal.timeout(S3_TIMEOUT_MS) });
    try {
      return await (this.opts.fetchImpl ?? fetch)(signed);
    } catch {
      throw new StorageError("Stockage objet injoignable.");
    }
  }

  private objectUrl(key: string): string {
    assertKey(key);
    return `${this.base}/${this.prefix}${key}.bin`;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const body = new Uint8Array(encrypt(this.key, key, data));
    const res = await this.send(this.objectUrl(key), { method: "PUT", body, headers: { "content-type": "application/octet-stream" } });
    if (!res.ok) throw new StorageError(`Écriture refusée par le stockage objet (${res.status}).`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.send(this.objectUrl(key));
    if (!res.ok) throw new StorageError(res.status === 404 ? "Fichier introuvable dans le stockage." : `Lecture refusée par le stockage objet (${res.status}).`);
    return decrypt(this.key, key, Buffer.from(await res.arrayBuffer()));
  }

  async delete(key: string): Promise<void> {
    const res = await this.send(this.objectUrl(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new StorageError(`Suppression refusée par le stockage objet (${res.status}).`);
  }

  private async list(params: Record<string, string>): Promise<string> {
    const qs = new URLSearchParams({ "list-type": "2", ...params });
    const res = await this.send(`${this.base}?${qs.toString()}`);
    if (!res.ok) throw new StorageError(`Listage refusé par le stockage objet (${res.status}).`);
    return res.text();
  }

  async deleteUser(userId: string): Promise<void> {
    assertUser(userId);
    // On relit la première page jusqu'à ce qu'elle soit vide (au lieu de suivre le jeton de
    // continuation) : robuste quelle que soit la sémantique de pagination du fournisseur
    // pendant que l'on supprime. Borne de sécurité contre une boucle infinie.
    for (let round = 0; round < 10_000; round++) {
      const keys = xmlValues(await this.list({ prefix: `${this.prefix}${userId}/` }), "Key");
      if (keys.length === 0) return;
      for (let i = 0; i < keys.length; i += 8) {
        await Promise.all(
          keys.slice(i, i + 8).map(async (k) => {
            const res = await this.send(`${this.base}/${k.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
            if (!res.ok && res.status !== 404) throw new StorageError(`Suppression refusée (${res.status}).`);
          }),
        );
      }
    }
    throw new StorageError("Suppression des fichiers interrompue (trop d'itérations).");
  }

  async listUserIds(): Promise<string[]> {
    const ids: string[] = [];
    let token: string | undefined;
    do {
      const xml = await this.list({ delimiter: "/", prefix: this.prefix, ...(token ? { "continuation-token": token } : {}) });
      for (const p of xmlValues(xml, "Prefix")) {
        const id = p.slice(this.prefix.length).replace(/\/$/, "");
        if (USER_RE.test(id)) ids.push(id);
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlValues(xml, "NextContinuationToken")[0] : undefined;
    } while (token);
    return ids;
  }
}

// ─────────────────────────────────────────────────────────────

let instance: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (!instance) {
    const cfg = getConfig();
    instance =
      cfg.STORAGE_DRIVER === "s3"
        ? new S3EncryptedStorage(
            {
              endpoint: cfg.S3_ENDPOINT!,
              region: cfg.S3_REGION,
              bucket: cfg.S3_BUCKET!,
              accessKeyId: cfg.S3_ACCESS_KEY_ID!,
              secretAccessKey: cfg.S3_SECRET_ACCESS_KEY!,
              prefix: cfg.S3_PREFIX,
            },
            cfg.storageKey,
          )
        : new LocalEncryptedStorage(path.resolve(cfg.STORAGE_DIR), cfg.storageKey);
  }
  return instance;
}

export function setStorageForTests(driver: StorageDriver | null): void {
  instance = driver;
}
