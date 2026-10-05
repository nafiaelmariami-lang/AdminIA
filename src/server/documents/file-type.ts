import { unzipSync } from "fflate";
import { HARD_LIMITS } from "@/lib/plans";

export type DetectedType =
  | { mime: "application/pdf"; kind: "pdf" }
  | { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; kind: "docx" }
  | { mime: "image/jpeg" | "image/png" | "image/webp"; kind: "image" }
  | { mime: "text/plain"; kind: "text" };

export class FileTypeError extends Error {}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/**
 * Détermine le type RÉEL d'un fichier à partir de son contenu (octets magiques).
 * Le type MIME et l'extension annoncés par le navigateur ne sont pas fiables et sont ignorés,
 * sauf pour les .txt (qui n'ont pas de signature) dont le contenu est vérifié.
 */
export function detectFileType(buf: Buffer, fileName: string): DetectedType {
  if (buf.length === 0) throw new FileTypeError("Le fichier est vide.");

  // PDF : en-tête %PDF- dans les 1024 premiers octets.
  const head = buf.subarray(0, 1024).toString("latin1");
  if (head.includes("%PDF-")) return { mime: "application/pdf", kind: "pdf" };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", kind: "image" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", kind: "image" };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", kind: "image" };
  if (buf.length > 12 && buf.subarray(4, 12).toString("latin1").match(/^ftyp(heic|heix|mif1|hevc)/)) {
    throw new FileTypeError("Les photos HEIC ne sont pas acceptées. Choisissez « JPEG » dans les réglages de l'appareil photo, ou exportez la photo en JPEG.");
  }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    inspectDocx(buf);
    return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx" };
  }
  if (/\.txt$/i.test(fileName) && isPlainText(buf)) return { mime: "text/plain", kind: "text" };

  throw new FileTypeError("Format non pris en charge. Formats acceptés : PDF, Word (.docx), JPEG, PNG, WEBP, texte (.txt).");
}

function isPlainText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Vérifie qu'une archive ZIP est bien un DOCX raisonnable, SANS la décompresser (anti zip-bomb). */
function inspectDocx(buf: Buffer): void {
  let entries = 0;
  let total = 0;
  let hasDocument = false;
  try {
    unzipSync(new Uint8Array(buf), {
      filter: (file) => {
        entries++;
        total += file.originalSize;
        if (file.name === "word/document.xml") hasDocument = true;
        return false; // ne rien décompresser ici
      },
    });
  } catch {
    throw new FileTypeError("Archive illisible : ce fichier n'est pas un document Word valide.");
  }
  if (!hasDocument) throw new FileTypeError("Seuls les documents Word (.docx) sont acceptés parmi les archives.");
  if (entries > HARD_LIMITS.maxDocxEntries || total > HARD_LIMITS.maxDocxUncompressedBytes) {
    throw new FileTypeError("Document Word trop volumineux une fois décompressé.");
  }
}
