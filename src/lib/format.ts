const DAY_MS = 86_400_000;

export function formatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: "Europe/Paris" }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatAmount(value: number | string | null | undefined, currency = "EUR"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** Nombre de jours entre aujourd'hui (Paris) et une date AAAA-MM-JJ. Négatif = dépassée. */
export function daysUntil(isoDate: string, now = new Date()): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function relativeDue(isoDate: string | null, now = new Date()): { text: string; tone: "late" | "soon" | "normal" | "none" } {
  if (!isoDate) return { text: "Sans date", tone: "none" };
  const d = daysUntil(isoDate, now);
  if (d < 0) return { text: d === -1 ? "En retard d'1 jour" : `En retard de ${-d} jours`, tone: "late" };
  if (d === 0) return { text: "Aujourd'hui", tone: "late" };
  if (d === 1) return { text: "Demain", tone: "soon" };
  if (d <= 7) return { text: `Dans ${d} jours`, tone: "soon" };
  return { text: `Dans ${d} jours`, tone: "normal" };
}
