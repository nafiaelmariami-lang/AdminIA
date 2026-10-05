import { describe, expect, it } from "vitest";
import { readBodyLimited, readFormLimited, readJson } from "@/server/http";
import { AppError } from "@/server/errors";

/** Requête dont le corps arrive par morceaux, sans Content-Length (envoi « chunked »). */
function chunkedRequest(totalBytes: number, chunk = 64 * 1024): { req: Request; produced: () => number } {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const n = Math.min(chunk, totalBytes - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n));
    },
  });
  return { req: new Request("http://localhost/x", { method: "POST", body, duplex: "half" } as RequestInit), produced: () => sent };
}

describe("lecture bornée des corps de requête", () => {
  it("s'arrête dès la limite dépassée, même sans Content-Length", async () => {
    const { req, produced } = chunkedRequest(50 * 1024 * 1024);
    const err = await readBodyLimited(req, 1024 * 1024).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(413);
    expect(produced()).toBeLessThan(3 * 1024 * 1024); // la lecture n'a pas consommé les 50 Mo
  });

  it("refuse d'emblée un Content-Length trop grand", async () => {
    const req = new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-length": String(10 ** 9) } });
    expect(((await readBodyLimited(req, 1000).catch((e) => e)) as AppError).status).toBe(413);
  });

  it("JSON : limite, JSON invalide, corps vide", async () => {
    expect(((await readJson(new Request("http://l/x", { method: "POST", body: "x".repeat(70_000) })).catch((e) => e)) as AppError).status).toBe(413);
    expect(((await readJson(new Request("http://l/x", { method: "POST", body: "{oups" })).catch((e) => e)) as AppError).status).toBe(400);
    expect(await readJson(new Request("http://l/x", { method: "POST" }))).toEqual({});
  });

  it("formulaire : type de contenu exigé, formulaire valide accepté", async () => {
    const notForm = new Request("http://l/x", { method: "POST", body: "a=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(((await readFormLimited(notForm, 1000).catch((e) => e)) as AppError).status).toBe(400);
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "a.bin"));
    const ok = await readFormLimited(new Request("http://l/x", { method: "POST", body: fd }), 10_000);
    expect((ok.get("file") as File).size).toBe(3);
  });
});
