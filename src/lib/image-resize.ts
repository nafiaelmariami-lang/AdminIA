"use client";

/**
 * Réduit une photo dans le navigateur avant l'envoi : une photo de téléphone (4000 px, 3 à 6 Mo)
 * devient une image de 2 400 px au plus, largement suffisante pour lire un courrier,
 * plus rapide à envoyer et moins coûteuse à analyser. Le serveur applique de toute façon ses propres limites.
 */
export const MAX_IMAGE_SIDE = 2400;
const TARGET_BYTES = 3 * 1024 * 1024;

export async function shrinkImageIfNeeded(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // format non décodable par le navigateur : le serveur décidera
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_IMAGE_SIDE && file.size <= TARGET_BYTES) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.fillStyle = "#fff"; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= TARGET_BYTES) return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" });
  }
  return file;
}
