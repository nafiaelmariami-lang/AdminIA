import "server-only";
import type { DetectedType } from "./file-type";

export type Extraction = { text: string | null; pageCount: number; mode: "text" | "vision" };

export class ExtractionError extends Error {}

const EXTRACTION_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ExtractionError("Lecture du document trop longue.")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Normalise le texte extrait : espaces, lignes vides multiples, caractères nuls. */
export function tidyText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extrait le texte. Un PDF sans couche texte (scan) ou une image passe en mode « vision » :
 * le fichier sera lu visuellement par l'IA.
 */
export async function extractContent(buf: Buffer, type: DetectedType): Promise<Extraction> {
  switch (type.kind) {
    case "pdf": {
      const { getDocumentProxy, extractText } = await import("unpdf");
      try {
        const result = await withTimeout(
          (async () => {
            const pdf = await getDocumentProxy(new Uint8Array(buf));
            return extractText(pdf, { mergePages: true });
          })(),
          EXTRACTION_TIMEOUT_MS,
        );
        const text = tidyText(result.text);
        const pages = result.totalPages;
        // Moins de ~40 caractères utiles par page : c'est un scan.
        const useful = text.replace(/\s/g, "").length;
        return useful < 40 * Math.max(1, pages) ? { text: text || null, pageCount: pages, mode: "vision" } : { text, pageCount: pages, mode: "text" };
      } catch (err) {
        if (err instanceof ExtractionError) throw err;
        const msg = err instanceof Error ? err.message : "";
        if (/password/i.test(msg)) throw new ExtractionError("Ce PDF est protégé par un mot de passe. Retirez la protection puis réessayez.");
        throw new ExtractionError("Ce PDF est illisible ou endommagé.");
      }
    }
    case "docx": {
      const mammoth = await import("mammoth");
      try {
        const { value } = await withTimeout(mammoth.extractRawText({ buffer: buf }), EXTRACTION_TIMEOUT_MS);
        const text = tidyText(value);
        if (!text) throw new ExtractionError("Ce document Word ne contient pas de texte.");
        return { text, pageCount: Math.max(1, Math.ceil(text.length / 3000)), mode: "text" };
      } catch (err) {
        if (err instanceof ExtractionError) throw err;
        throw new ExtractionError("Ce document Word est illisible ou endommagé.");
      }
    }
    case "image":
      return { text: null, pageCount: 1, mode: "vision" };
    case "text": {
      const text = tidyText(buf.toString("utf-8"));
      if (!text) throw new ExtractionError("Le fichier texte est vide.");
      return { text, pageCount: Math.max(1, Math.ceil(text.length / 3000)), mode: "text" };
    }
  }
}
