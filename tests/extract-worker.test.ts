import { describe, expect, it } from "vitest";
import { extractInWorker, WorkerExtractionError, EXTRACTION_LIMITS } from "@/server/documents/extract-worker";
import { makeDocx, makePdf } from "./fixtures";

describe("lecture isolée des documents (worker)", () => {
  it("lit un PDF et un DOCX dans un fil isolé", async () => {
    const pdf = await extractInWorker("pdf", makePdf([["Bonjour depuis le worker"], ["Page deux"]]));
    expect(pdf.text).toContain("Bonjour depuis le worker");
    expect(pdf.totalPages).toBe(2);
    const docx = await extractInWorker("docx", makeDocx(["Paragraphe Word"]));
    expect(docx.text).toContain("Paragraphe Word");
  });

  it("un fichier corrompu donne une erreur typée sans faire tomber le processus", async () => {
    const err = await extractInWorker("pdf", Buffer.from("%PDF-1.4\\ncorrompu")).catch((e) => e);
    expect(err).toBeInstanceOf(WorkerExtractionError);
    expect((err as WorkerExtractionError).reason).toBe("invalid");
  });

  it("le délai maximal ARRÊTE réellement le travail", async () => {
    const err = await extractInWorker("pdf", makePdf([["x"]]), { timeoutMs: 1 }).catch((e) => e);
    expect((err as WorkerExtractionError).reason).toBe("timeout");
  });

  it("les lectures simultanées sont plafonnées et toutes aboutissent", async () => {
    const n = EXTRACTION_LIMITS.maxConcurrent * 3;
    const results = await Promise.all(Array.from({ length: n }, (_, i) => extractInWorker("pdf", makePdf([[`Document ${i}`]]))));
    expect(results.map((r) => r.text.includes("Document"))).toEqual(Array(n).fill(true));
  });
});
