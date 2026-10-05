"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { CATEGORY_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/primitives";

export function AnalyzeButton({ documentId, label = "Analyser ce document", variant = "primary" }: { documentId: string; label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        variant={variant}
        icon="sparkles"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await apiFetch(`/api/documents/${documentId}/analyze`, { method: "POST" });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Analyse impossible.");
          }
          setPending(false);
          router.refresh();
        }}
      >
        {pending ? "Analyse en cours…" : label}
      </Button>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}

export function DeleteDocumentButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      icon="trash"
      disabled={pending}
      className="text-red-700 hover:bg-red-50"
      onClick={async () => {
        if (!confirm("Supprimer définitivement ce document, son analyse et ses échéances ?")) return;
        setPending(true);
        try {
          await apiFetch(`/api/documents/${documentId}`, { method: "DELETE" });
          router.replace("/app/documents");
          router.refresh();
        } catch (err) {
          alert(err instanceof Error ? err.message : "Suppression impossible.");
          setPending(false);
        }
      }}
    >
      Supprimer
    </Button>
  );
}

export function EditDocumentForm({ documentId, title, category }: { documentId: string; title: string; category: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand-700 hover:text-brand-800">
        Corriger le titre ou le classement
      </button>
    );
  }
  const field = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await apiFetch(`/api/documents/${documentId}`, { method: "PATCH", json: { title: f.get("title"), category: f.get("category") } });
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Modification impossible.");
        }
      }}
    >
      <label className="block text-sm font-medium text-slate-700">
        Titre
        <input name="title" defaultValue={title} required maxLength={200} className={field} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Classement
        <select name="category" defaultValue={category ?? "autre"} className={field}>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit">Enregistrer</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
