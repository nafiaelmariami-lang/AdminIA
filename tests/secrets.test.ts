import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Garde-fou : aucun secret ne doit être versionné. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ["clé Anthropic", /sk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{20,}/],
  ["clé Stripe", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/],
  ["secret de webhook Stripe", /\bwhsec_[A-Za-z0-9]{16,}/],
  ["clé Brevo", /\bxkeysib-[a-f0-9]{32,}/],
  ["clé AWS / S3", /\bAKIA[0-9A-Z]{16}\b/],
  ["clé privée", /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["URL de base avec mot de passe réel", /postgres(ql)?:\/\/[^:\s"'`]+:(?!CHANGER_MOI|p@|u:p|\$\{)[^@\s"'`]{6,}@(?!localhost\/db)/],
];

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const textFiles = tracked.filter((f) => !/\.(png|jpe?g|webp|ico|pdf|lock)$/i.test(f) && f !== "package-lock.json");

describe("aucun secret dans le dépôt", () => {
  it("aucun fichier .env versionné hormis .env.example", () => {
    expect(tracked.filter((f) => /(^|\/)\.env/.test(f) && !f.endsWith(".env.example"))).toEqual([]);
  });

  it(".env.example ne contient aucune valeur secrète", () => {
    const example = readFileSync(".env.example", "utf8");
    for (const key of ["ANTHROPIC_API_KEY", "STORAGE_ENCRYPTION_KEY", "BREVO_API_KEY", "S3_SECRET_ACCESS_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CRON_SECRET"]) {
      const line = example.split("\n").find((l) => l.startsWith(`${key}=`));
      if (line) expect(line, key).toBe(`${key}=`);
    }
  });

  it.each(SECRET_PATTERNS)("aucun motif « %s » dans les fichiers suivis", (_label, re) => {
    const hits = textFiles.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("les motifs détectent bien des secrets (échantillons construits à l'exécution)", () => {
  const r = (n: number) => "A1b2C3d4E5".repeat(Math.ceil(n / 10)).slice(0, n);
  const samples: Record<string, string> = {
    "clé Anthropic": ["sk", "ant", "api03", r(40)].join("-"),
    "clé Stripe": ["sk", "live", r(24)].join("_"),
    "secret de webhook Stripe": ["whsec", r(24)].join("_"),
    "clé Brevo": ["xkeysib", "a".repeat(64)].join("-"),
    "clé AWS / S3": "AKIA" + "ABCDEFGHIJKLMNOP",
    "clé privée": "-----BEGIN " + "PRIVATE KEY-----",
    "jeton GitHub": "ghp" + "_" + r(36),
    "URL de base avec mot de passe réel": "postgres" + "://admin:Vr4iM0tDeP4sse@db.exemple.fr/prod",
  };
  it.each(SECRET_PATTERNS)("« %s » est détecté", (label, re) => {
    expect(re.test(samples[label]!)).toBe(true);
  });
});
