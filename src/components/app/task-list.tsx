"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatDate, relativeDue } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

export type TaskView = {
  id: string;
  title: string;
  dueDate: string | null;
  status: "todo" | "done";
  priority: string;
  documentId: string | null;
  documentTitle?: string | null;
  source: string;
};

const TONE = { late: "text-red-700 bg-red-50", soon: "text-orange-800 bg-orange-50", normal: "text-slate-700 bg-slate-100", none: "text-slate-500 bg-slate-100" } as const;

export function TaskList({ tasks, showDocument = true, emptyText = "Rien à faire pour le moment." }: { tasks: TaskView[]; showDocument?: boolean; emptyText?: string }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setPendingId(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setPendingId(null);
    }
  }

  if (tasks.length === 0) return <p className="px-5 py-6 text-sm text-slate-500">{emptyText}</p>;

  return (
    <div>
      {error && <p className="px-5 pt-3 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-slate-100">
        {tasks.map((t) => {
          const due = relativeDue(t.status === "done" ? null : t.dueDate);
          const done = t.status === "done";
          return (
            <li key={t.id} className={`flex items-start gap-3 px-5 py-3.5 ${pendingId === t.id ? "opacity-60" : ""}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={done ? `Marquer « ${t.title} » comme à faire` : `Marquer « ${t.title} » comme fait`}
                disabled={pendingId === t.id}
                onClick={() => act(t.id, () => apiFetch(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: done ? "todo" : "done" } }))}
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 hover:border-brand-500"}`}
              >
                {done && <Icon name="check" className="h-3.5 w-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-900"}`}>{t.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {t.dueDate && !done && <span className={`rounded-md px-2 py-0.5 font-semibold ${TONE[due.tone]}`}>{due.text}</span>}
                  {t.dueDate && <span className="text-slate-500">{formatDate(t.dueDate)}</span>}
                  {t.priority === "haute" && !done && <span className="font-semibold text-red-700">Prioritaire</span>}
                  {showDocument && t.documentId && t.documentTitle && (
                    <Link href={`/app/documents/${t.documentId}`} className="truncate text-brand-700 hover:underline">
                      {t.documentTitle}
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {t.dueDate && !done && (
                  <a href={`/api/tasks/calendar?id=${t.id}`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Ajouter à mon agenda" aria-label="Ajouter à mon agenda">
                    <Icon name="calendar" className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Supprimer cette échéance ?")) void act(t.id, () => apiFetch(`/api/tasks/${t.id}`, { method: "DELETE" }));
                  }}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                  title="Supprimer"
                  aria-label="Supprimer l'échéance"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AddTaskForm({ documentId }: { documentId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
        <Icon name="plus" className="h-4 w-4" /> Ajouter une échéance
      </button>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        json: { title: f.get("title"), dueDate: f.get("dueDate") || null, priority: f.get("priority"), ...(documentId ? { documentId } : {}) },
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ajouter l'échéance.");
    } finally {
      setPending(false);
    }
  }

  const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_auto_auto_auto]">
      <input name="title" required maxLength={300} placeholder="Ex : Déclarer mon chiffre d'affaires" className={field} aria-label="Intitulé" />
      <input name="dueDate" type="date" className={field} aria-label="Date limite" />
      <select name="priority" defaultValue="moyenne" className={field} aria-label="Priorité">
        <option value="haute">Prioritaire</option>
        <option value="moyenne">Normale</option>
        <option value="basse">Basse</option>
      </select>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          Ajouter
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200">
          Annuler
        </button>
      </div>
      {error && <p className="text-sm text-red-700 sm:col-span-4">{error}</p>}
    </form>
  );
}
