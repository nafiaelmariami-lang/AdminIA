"use client";

/** Appel d'API depuis le navigateur. Le cookie de session est envoyé automatiquement (même origine). */
export async function apiFetch<T = unknown>(path: string, opts: { method?: string; json?: unknown; body?: BodyInit } = {}): Promise<T> {
  const headers: HeadersInit = opts.json !== undefined ? { "Content-Type": "application/json" } : {};
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Connexion impossible. Vérifiez votre accès à Internet.");
  }
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
      // Session expirée : rechargement complet volontaire pour repartir d'un état propre.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/connexion";
    }
    throw new Error(data?.error?.message ?? "Une erreur est survenue.");
  }
  return data as T;
}
