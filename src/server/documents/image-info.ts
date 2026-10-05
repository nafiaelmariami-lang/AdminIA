/**
 * Lecture des dimensions d'une image à partir de son en-tête, sans la décoder
 * (aucune dépendance, aucun risque de « bombe de décompression »).
 */
export type ImageSize = { width: number; height: number };

export function readImageSize(buf: Buffer, mime: "image/jpeg" | "image/png" | "image/webp"): ImageSize | null {
  try {
    if (mime === "image/png") {
      // Signature (8) + longueur (4) + « IHDR » (4) + largeur (4) + hauteur (4)
      if (buf.length < 24 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/webp") {
      if (buf.length < 30) return null;
      const chunk = buf.toString("latin1", 12, 16);
      if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
      return null;
    }
    // JPEG : on parcourt les segments jusqu'à un marqueur SOF (début de trame).
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buf.readUInt16BE(offset + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}
