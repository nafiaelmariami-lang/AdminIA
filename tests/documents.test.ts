import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { zipSync } from "fflate";
import * as docsRoute from "@/app/api/documents/route";
import * as docRoute from "@/app/api/documents/[id]/route";
import * as fileRoute from "@/app/api/documents/[id]/file/route";
import { documents } from "@/server/db/schema";
import { setSetting } from "@/server/settings";
import { apiRequest, ctx, setupTestApp, signUp, upload, uploadOk, type TestApp } from "./helpers";
import { makeDocx, makeJpegHeader, makePdf, makePng, makeScannedPdf, PNG_1PX, PNG_DOC, URSSAF_LETTER } from "./fixtures";

let app: TestApp;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => app.close());

type ListBody = { items: { id: string; title: string }[]; total: number };
const list = async (token: string, qs = "") => (await (await docsRoute.GET(apiRequest(`/api/documents${qs}`, { token }), undefined)).json()) as ListBody;

describe("ajout de documents", () => {
  it("accepte un PDF texte, en extrait le texte et le stocke chiffré", async () => {
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "courrier-urssaf.pdf", makePdf([URSSAF_LETTER]));
    expect(doc.status).toBe("uploaded");
    const [row] = await app.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row!.mimeType).toBe("application/pdf");
    expect(row!.contentMode).toBe("text");
    expect(row!.extractedText).toContain("cotisations");
    expect(row!.pageCount).toBe(1);
    // Le fichier sur disque est chiffré : le texte n'y apparaît pas en clair.
    const onDisk = await readFile(path.join(app.storageDir, `${row!.storageKey}.bin`));
    expect(onDisk.includes(Buffer.from("cotisations"))).toBe(false);
    expect(onDisk.includes(Buffer.from("%PDF"))).toBe(false);
  });

  it("accepte DOCX, PNG (mode vision), texte et PDF scanné (mode vision)", async () => {
    const u = await signUp(app);
    const docx = await uploadOk(u.token, "contrat.docx", makeDocx(["Contrat d'assurance", "Échéance annuelle le 01/01/2027"]));
    const png = await uploadOk(u.token, "photo.png", PNG_DOC);
    const txt = await uploadOk(u.token, "note.txt", Buffer.from("Relance fournisseur : facture impayée de 120,00 €"));
    const scan = await uploadOk(u.token, "scan.pdf", makeScannedPdf(2));
    const rows = await app.db.select().from(documents).where(eq(documents.userId, u.userId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(docx.id)!.extractedText).toContain("Contrat d'assurance");
    expect(byId.get(png.id)!.contentMode).toBe("vision");
    expect(byId.get(txt.id)!.mimeType).toBe("text/plain");
    expect(byId.get(scan.id)!.contentMode).toBe("vision");
    expect(byId.get(scan.id)!.pageCount).toBe(2);
  });

  it("détermine le type par le contenu, pas par le nom ou le type annoncé", async () => {
    const u = await signUp(app);
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(200, 1)]);
    expect((await upload(u.token, "facture.pdf", exe)).status).toBe(415);
    expect((await upload(u.token, "script.txt", Buffer.from([0x00, 0x01, 0x02, 0xff]))).status).toBe(415);
    expect((await upload(u.token, "page.html", Buffer.from("<script>alert(1)</script>"))).status).toBe(415);
    // Un vrai PDF nommé .jpg est reconnu comme PDF.
    const res = await upload(u.token, "image.jpg", makePdf([["Bonjour"]]));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { document: { mimeType: string } }).document.mimeType).toBe("application/pdf");
  });

  it("refuse fichiers vides, PDF corrompus, HEIC, ZIP non Word et zip-bomb", async () => {
    const u = await signUp(app);
    expect((await upload(u.token, "vide.pdf", Buffer.alloc(0))).status).toBe(400 + 15);
    expect((await upload(u.token, "casse.pdf", Buffer.from("%PDF-1.4\nn'importe quoi"))).status).toBe(422);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
    expect((await upload(u.token, "photo.heic", heic)).status).toBe(415);
    const zip = Buffer.from(zipSync({ "a.txt": new Uint8Array([1, 2, 3]) }));
    expect((await upload(u.token, "archive.docx", zip)).status).toBe(415);
    const bomb = Buffer.from(zipSync({ "word/document.xml": new Uint8Array(70 * 1024 * 1024) }, { level: 9 }));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const res = await upload(u.token, "bombe.docx", bomb);
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/décompressé/);
  });

  it("contrôle les dimensions et le poids des images (limites de l'API de vision)", async () => {
    const u = await signUp(app, { plan: "pro" });
    expect((await upload(u.token, "minuscule.png", PNG_1PX)).status).toBe(422);
    expect((await upload(u.token, "geante.jpg", makeJpegHeader(9000, 4000))).status).toBe(413);
    expect((await upload(u.token, "photo.jpg", makeJpegHeader(3024, 4032))).status).toBe(201);
    expect((await upload(u.token, "tronquee.png", PNG_DOC.subarray(0, 20))).status).toBe(415);
    const heavy = Buffer.concat([makePng(1000, 1000), Buffer.alloc(4 * 1024 * 1024)]);
    const res = await upload(u.token, "lourde.png", heavy);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/3,7 Mo/);
  });

  it("applique la taille maximale de la formule (gros documents)", async () => {
    const u = await signUp(app); // Découverte : 10 Mo
    const big = Buffer.concat([makePdf([["gros"]]), Buffer.alloc(11 * 1024 * 1024, 32)]);
    expect((await upload(u.token, "gros.pdf", big)).status).toBe(413);
    const pro = await signUp(app, { plan: "pro" }); // Pro : 20 Mo
    expect((await upload(pro.token, "gros.pdf", big)).status).toBe(201);
  });

  it("refuse un document trop long en pages et un scan trop long", async () => {
    const u = await signUp(app); // Découverte : 20 pages
    const many = makePdf(Array.from({ length: 21 }, (_, i) => [`Page ${i + 1} : ${"texte ".repeat(20)}`]));
    expect((await upload(u.token, "long.pdf", many)).status).toBe(413);
    const pro = await signUp(app, { plan: "pro" });
    expect((await upload(pro.token, "scan-long.pdf", makeScannedPdf(16))).status).toBe(413);
    expect((await upload(pro.token, "scan-ok.pdf", makeScannedPdf(15))).status).toBe(201);
  });

  it("ne duplique pas un fichier déjà ajouté", async () => {
    const u = await signUp(app);
    const pdf = makePdf([["Document unique 123"]]);
    const first = await upload(u.token, "a.pdf", pdf);
    const second = await upload(u.token, "b.pdf", pdf);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const b1 = (await first.json()) as { document: { id: string } };
    const b2 = (await second.json()) as { document: { id: string }; duplicate: boolean };
    expect(b2.duplicate).toBe(true);
    expect(b2.document.id).toBe(b1.document.id);
    expect((await list(u.token)).total).toBe(1);
  });

  it("applique le quota de documents stockés et la limite de fréquence", async () => {
    const u = await signUp(app);
    await app.db.insert(documents).values(
      Array.from({ length: 50 }, (_, i) => ({
        userId: u.userId, originalName: `d${i}.pdf`, mimeType: "application/pdf", sizeBytes: 1,
        storageKey: `${u.userId}/00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, sha256: `h${i}`, contentMode: "text" as const,
      })),
    );
    const res = await upload(u.token, "un-de-trop.pdf", makePdf([["trop"]]));
    expect(res.status).toBe(403);

    const v = await signUp(app); // 20 ajouts / heure
    for (let i = 0; i < 20; i++) expect((await upload(v.token, `f${i}.txt`, Buffer.from(`note ${i}`))).status).toBe(201);
    expect((await upload(v.token, "f21.txt", Buffer.from("note 21"))).status).toBe(429);
  });

  it("peut être désactivé par l'interrupteur uploads_enabled", async () => {
    const u = await signUp(app);
    await setSetting(app.db, "uploads_enabled", false);
    expect((await upload(u.token, "a.txt", Buffer.from("x"))).status).toBe(503);
    await setSetting(app.db, "uploads_enabled", true);
  });

  it("refuse une requête sans fichier ou non authentifiée", async () => {
    const u = await signUp(app);
    const form = new FormData();
    form.set("autre", "valeur");
    expect((await docsRoute.POST(apiRequest("/api/documents", { method: "POST", token: u.token, form }), undefined)).status).toBe(400);
    expect((await upload("", "a.txt", Buffer.from("x"))).status).toBe(401);
  });

  it("nettoie le nom de fichier (chemins, caractères de contrôle)", async () => {
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "../../etc/pass\u0007wd<x>.txt", Buffer.from("contenu"));
    expect(doc.originalName).toBe("pass wd_x_.txt".replace(" ", ""));
  });
});

describe("consultation, recherche, modification, suppression", () => {
  it("liste, recherche en français (racines) et filtre", async () => {
    const u = await signUp(app);
    await uploadOk(u.token, "urssaf.pdf", makePdf([URSSAF_LETTER]));
    await uploadOk(u.token, "devis.txt", Buffer.from("Devis plomberie : remplacement chauffe-eau, 890 €"));
    expect((await list(u.token)).total).toBe(2);
    expect((await list(u.token, "?q=cotisation")).items).toHaveLength(1); // « cotisations » dans le document
    expect((await list(u.token, "?q=chauffe-eau")).items).toHaveLength(1);
    expect((await list(u.token, "?q=AB12345678")).items).toHaveLength(1);
    expect((await list(u.token, "?q=introuvable")).items).toHaveLength(0);
    expect((await list(u.token, "?q=%25")).items).toHaveLength(0); // caractères joker échappés
    const bad = await docsRoute.GET(apiRequest("/api/documents?category=piratage", { token: u.token }), undefined);
    expect(bad.status).toBe(400);
  });

  it("renvoie le détail sans clé de stockage, puis le fichier original", async () => {
    const u = await signUp(app);
    const pdf = makePdf([["Original"]]);
    const doc = await uploadOk(u.token, "orig.pdf", pdf);
    const res = await docRoute.GET(apiRequest(`/api/documents/${doc.id}`, { token: u.token }), ctx(doc.id));
    const body = (await res.json()) as { document: Record<string, unknown> };
    expect(body.document.storageKey).toBeUndefined();
    expect(body.document.sha256).toBeUndefined();
    expect(body.document.userId).toBeUndefined();
    const file = await fileRoute.GET(apiRequest(`/api/documents/${doc.id}/file`, { token: u.token }), ctx(doc.id));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await file.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it("permet de corriger le titre et la catégorie, refuse les champs non autorisés", async () => {
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "a.txt", Buffer.from("x"));
    const patch = (json: unknown) => docRoute.PATCH(apiRequest(`/api/documents/${doc.id}`, { method: "PATCH", token: u.token, json }), ctx(doc.id));
    expect((await patch({ title: "Mon titre", category: "impots" })).status).toBe(200);
    expect((await patch({ userId: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
    expect((await patch({ status: "analyzed" })).status).toBe(400);
    expect((await patch({ category: "inconnue" })).status).toBe(400);
  });

  it("supprime le document et son fichier chiffré", async () => {
    const u = await signUp(app);
    const doc = await uploadOk(u.token, "a-supprimer.txt", Buffer.from("à supprimer"));
    const userDir = path.join(app.storageDir, u.userId);
    expect(await readdir(userDir)).toHaveLength(1);
    const res = await docRoute.DELETE(apiRequest(`/api/documents/${doc.id}`, { method: "DELETE", token: u.token }), ctx(doc.id));
    expect(res.status).toBe(200);
    expect(await readdir(userDir)).toHaveLength(0);
    expect((await docRoute.GET(apiRequest(`/api/documents/${doc.id}`, { token: u.token }), ctx(doc.id))).status).toBe(404);
  });
});
