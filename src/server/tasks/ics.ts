/**
 * Génération d'un calendrier iCalendar (RFC 5545) : les échéances s'ajoutent à Google Agenda,
 * Outlook ou Calendrier Apple, avec un rappel la veille et une semaine avant.
 */
type IcsTask = { id: string; title: string; dueDate: string | null; documentTitle?: string | null };

function escapeText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Plie les lignes à 75 octets comme l'exige la norme. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > 74) {
      out.push(current);
      current = " " + ch;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n");
}

const compact = (d: string) => d.replace(/-/g, "");

function nextDay(d: string): string {
  const date = new Date(`${d}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function buildIcs(items: IcsTask[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AdminIA//Echeances//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:AdminIA — échéances"];
  for (const t of items) {
    if (!t.dueDate) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${t.id}@adminia`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(t.dueDate)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(t.dueDate))}`,
      `SUMMARY:${escapeText(`[AdminIA] ${t.title}`)}`,
      ...(t.documentTitle ? [`DESCRIPTION:${escapeText(`Document : ${t.documentTitle}`)}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(t.title)}`, "TRIGGER:-P7D", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(t.title)}`, "TRIGGER:-P1D", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
