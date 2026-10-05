/**
 * Journalisation structurée (une ligne JSON par événement), lisible par tout hébergeur.
 *
 * Règles :
 *  - jamais de contenu de document, de mot de passe, de jeton ni de clé ;
 *  - les champs au nom sensible sont masqués automatiquement, même par erreur ;
 *  - l'adresse e-mail est remplacée par un identifiant utilisateur quand c'est possible.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|signature|^text$|content|prompt|iban|card/i;
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const env = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "error" : "info")) as Level;
  return LEVELS[env] ?? LEVELS.info;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (value instanceof Error) return { name: value.name, message: value.message.slice(0, 300) };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields)) out[k] = SENSITIVE_KEY.test(k) ? "[masqué]" : redact(v, depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function write(level: Level, event: string, fields: Fields = {}): void {
  if (LEVELS[level] < minLevel()) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...(redact(fields) as Fields) });
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
