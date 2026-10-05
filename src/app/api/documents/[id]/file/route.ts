import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { readDocumentFile } from "@/server/documents/service";

type Ctx = { params: Promise<{ id: string }> };

const INLINE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const { doc, data } = await readDocumentFile(await getDb(), user.id, id);
  const download = new URL(req.url).searchParams.get("download") === "1" || !INLINE_TYPES.has(doc.mimeType);
  const encoded = encodeURIComponent(doc.originalName);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="document"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Le fichier est isolé : aucun script ne peut s'exécuter dans notre origine.
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
});
