import "server-only";
import { Worker } from "node:worker_threads";
import path from "node:path";

/**
 * Lecture des PDF et documents Word dans un fil d'exécution ISOLÉ (worker thread) :
 *  - mémoire plafonnée : un fichier piégé ne peut pas faire tomber le serveur ;
 *  - délai maximal avec ARRÊT RÉEL du travail (terminate), pas seulement abandon de la promesse ;
 *  - nombre de lectures simultanées limité par processus.
 * Le code du worker est autonome (chargé en mémoire) : il ne dépend pas du bundler.
 */

export type WorkerKind = "pdf" | "docx";
export type WorkerResult = { text: string; totalPages: number };

export class WorkerExtractionError extends Error {
  constructor(
    public readonly reason: "timeout" | "memory" | "password" | "invalid" | "crash",
    message: string,
  ) {
    super(message);
  }
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const req = createRequire(workerData.base);
(async () => {
  const data = new Uint8Array(workerData.buffer);
  if (workerData.kind === "pdf") {
    const { getDocumentProxy, extractText } = await import(req.resolve("unpdf"));
    const pdf = await getDocumentProxy(data);
    const r = await extractText(pdf, { mergePages: true });
    parentPort.postMessage({ ok: true, text: r.text, totalPages: r.totalPages });
  } else {
    const mammoth = req("mammoth");
    const r = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    parentPort.postMessage({ ok: true, text: r.value, totalPages: 0 });
  }
})().catch((e) => {
  const msg = String((e && e.message) || e);
  parentPort.postMessage({ ok: false, reason: /password/i.test(msg) ? "password" : "invalid" });
});
`;

export const EXTRACTION_LIMITS = { timeoutMs: 20_000, maxOldGenerationSizeMb: 256, maxConcurrent: 4 } as const;

let running = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (running < EXTRACTION_LIMITS.maxConcurrent) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
}

function release(): void {
  running--;
  waiting.shift()?.();
}

export async function extractInWorker(kind: WorkerKind, buf: Buffer, opts: { timeoutMs?: number } = {}): Promise<WorkerResult> {
  await acquire();
  try {
    return await new Promise<WorkerResult>((resolve, reject) => {
      // Copie dans un ArrayBuffer transférable (le Buffer d'origine peut partager un pool mémoire).
      const copy = new Uint8Array(buf.length);
      copy.set(buf);
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { kind, buffer: copy.buffer, base: path.join(process.cwd(), "package.json") },
        transferList: [copy.buffer],
        resourceLimits: { maxOldGenerationSizeMb: EXTRACTION_LIMITS.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      });
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new WorkerExtractionError("timeout", "Lecture du document trop longue."))),
        opts.timeoutMs ?? EXTRACTION_LIMITS.timeoutMs,
      );
      worker.once("message", (m: { ok: boolean; text?: string; totalPages?: number; reason?: "password" | "invalid" }) =>
        finish(() =>
          m.ok
            ? resolve({ text: m.text ?? "", totalPages: m.totalPages ?? 0 })
            : reject(new WorkerExtractionError(m.reason ?? "invalid", m.reason === "password" ? "Document protégé par mot de passe." : "Document illisible.")),
        ),
      );
      worker.once("error", (err: Error & { code?: string }) =>
        finish(() =>
          reject(
            err.code === "ERR_WORKER_OUT_OF_MEMORY"
              ? new WorkerExtractionError("memory", "Document trop complexe à lire.")
              : new WorkerExtractionError("crash", "Lecture du document impossible."),
          ),
        ),
      );
      worker.once("exit", (code) => finish(() => reject(new WorkerExtractionError("crash", `Lecture interrompue (${code}).`))));
    });
  } finally {
    release();
  }
}
