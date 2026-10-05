"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { shrinkImageIfNeeded } from "@/lib/image-resize";
import { Icon } from "@/components/ui/icon";

const ACCEPT = ".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
const MAX_FILES = 10;

type Item = { key: string; name: string; state: "upload" | "analyse" | "done" | "error"; message?: string; docId?: string };

type UploadResult = { document: { id: string; status: string }; duplicate: boolean };

export function UploadDropzone({ compact = false, canAnalyze = true }: { compact?: boolean; canAnalyze?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = items.some((i) => i.state === "upload" || i.state === "analyse");

  const update = (key: string, patch: Partial<Item>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function processFile(file: File, key: string): Promise<string | null> {
    const form = new FormData();
    form.set("file", await shrinkImageIfNeeded(file));
    let uploaded: UploadResult;
    try {
      uploaded = await apiFetch<UploadResult>("/api/documents", { method: "POST", body: form });
    } catch (err) {
      update(key, { state: "error", message: err instanceof Error ? err.message : "Envoi impossible." });
      return null;
    }
    const id = uploaded.document.id;
    if (uploaded.duplicate && uploaded.document.status === "analyzed") {
      update(key, { state: "done", docId: id, message: "Ce document était déjà dans votre espace." });
      return id;
    }
    if (!canAnalyze) {
      update(key, { state: "done", docId: id, message: "Document enregistré. Confirmez votre adresse e-mail pour lancer l'analyse." });
      return id;
    }
    update(key, { state: "analyse", docId: id });
    try {
      await apiFetch(`/api/documents/${id}/analyze`, { method: "POST" });
      update(key, { state: "done", docId: id });
    } catch (err) {
      // Le document est bien enregistré, seule l'analyse a échoué.
      update(key, { state: "error", docId: id, message: `Document enregistré, mais : ${err instanceof Error ? err.message : "analyse impossible."}` });
    }
    return id;
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    const files = Array.from(list).slice(0, MAX_FILES);
    const newItems = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, state: "upload" as const }));
    setItems(newItems);
    const ids: (string | null)[] = [];
    // Un fichier après l'autre : une seule analyse à la fois par compte (protection côté serveur).
    for (let i = 0; i < files.length; i++) ids.push(await processFile(files[i]!, newItems[i]!.key));
    if (inputRef.current) inputRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    if (files.length === 1 && ids[0]) router.push(`/app/documents/${ids[0]}`);
    else router.refresh();
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed text-center transition-colors ${compact ? "px-4 py-6" : "px-6 py-10"} ${dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white"}`}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon name="upload" className="h-6 w-6" />
        </div>
        <p className="mt-4 text-base font-semibold text-slate-900">Ajoutez un courrier, une facture, un contrat…</p>
        <p className="mt-1 text-sm text-slate-500">Glissez vos fichiers ici, ou choisissez une option. PDF, Word, photo (JPEG, PNG, WEBP).</p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            <Icon name="document" className="h-4 w-4" /> Choisir des fichiers
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-60 sm:hidden"
          >
            <Icon name="camera" className="h-4 w-4" /> Prendre en photo
          </button>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => void handleFiles(e.target.files)} aria-label="Choisir des fichiers" />
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" onChange={(e) => void handleFiles(e.target.files)} aria-label="Prendre une photo" />
      </div>

      {items.length > 0 && (
        <ul className="mt-4 space-y-2" aria-live="polite">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <span className="mt-0.5">
                {i.state === "done" ? (
                  <Icon name="check" className="h-5 w-5 text-emerald-600" />
                ) : i.state === "error" ? (
                  <Icon name="alert" className="h-5 w-5 text-red-600" />
                ) : (
                  <span className="block h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{i.name}</p>
                <p className={i.state === "error" ? "text-red-700" : "text-slate-500"}>
                  {i.state === "upload" && "Envoi sécurisé…"}
                  {i.state === "analyse" && "Lecture et analyse du document (quelques secondes)…"}
                  {i.state === "done" && (i.message ?? "Analyse terminée")}
                  {i.state === "error" && i.message}
                </p>
              </div>
              {i.docId && i.state !== "upload" && i.state !== "analyse" && (
                <Link href={`/app/documents/${i.docId}`} className="shrink-0 font-semibold text-brand-700">
                  Ouvrir
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
