import "server-only";
import type { DetectedType } from "./file-type";
import { extractInWorker, WorkerExtractionError } from "./extract-worker";

export type Extraction = { text: string | null; pageCount: number; mode: "text" | "vision" };

export class ExtractionError extends Error {}

function toExtractionError(err: unknown, invalid: string, password: string): ExtractionError {
  if (err instanceof WorkerExtractionError) {
    if (err.reason === "password") return new ExtractionError(password);
    if (err.reason === "timeout" || err.reason === "memory") return new ExtractionError("Ce document est trop complexe pour être lu. Essayez de l'exporter à nouveau en PDF.");
  }
  return new ExtractionError(invalid);
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
      try {
        const result = await extractInWorker("pdf", buf);
        const text = tidyText(result.text);
        const pages = result.totalPages;
        // Moins de ~40 caractères utiles par page : c'est un scan.
        const useful = text.replace(/\s/g, "").length;
        return useful < 40 * Math.max(1, pages) ? { text: text || null, pageCount: pages, mode: "vision" } : { text, pageCount: pages, mode: "text" };
      } catch (err) {
        throw toExtractionError(err, "Ce PDF est illisible ou endommagé.", "Ce PDF est protégé par un mot de passe. Retirez la protection puis réessayez.");
      }
    }
    case "docx": {
      let value: string;
      try {
        value = (await extractInWorker("docx", buf)).text;
      } catch (err) {
        throw toExtractionError(err, "Ce document Word est illisible ou endommagé.", "Ce document Word est protégé par un mot de passe.");
      }
      const text = tidyText(value);
      if (!text) throw new ExtractionError("Ce document Word ne contient pas de texte.");
      return { text, pageCount: Math.max(1, Math.ceil(text.length / 3000)), mode: "text" };
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
