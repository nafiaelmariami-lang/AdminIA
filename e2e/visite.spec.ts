import { expect, test } from "@playwright/test";
import { makePdf, URSSAF_LETTER, INJECTION_LETTER } from "../tests/fixtures";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Visite visuelle de toutes les pages (captures d'écran pour revue UX).
 * Exécutée seulement avec E2E_TOUR=1 : npm run test:e2e -- visite
 */
test.skip(!process.env.E2E_TOUR, "visite visuelle désactivée (E2E_TOUR=1 pour l'activer)");

const SHOTS = process.env.E2E_SCREENSHOTS_DIR ?? "test-results";

async function verifyLink(to: string): Promise<string> {
  const dir = process.env.E2E_OUTBOX_DIR!;
  for (let i = 0; i < 50; i++) {
    for (const f of readdirSync(dir).sort().reverse()) {
      const m = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { to: string; tag: string; text: string };
      const url = m.to === to && m.tag === "verify_email" ? /https?:\/\/\S+token=[A-Za-z0-9_-]+/.exec(m.text)?.[0] : undefined;
      if (url) return new URL(url).pathname + new URL(url).search;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("pas d'e-mail");
}

test("visite de toutes les pages", async ({ page }, info) => {
  test.setTimeout(180_000);
  const p = info.project.name;
  const shot = async (name: string) => page.screenshot({ path: `${SHOTS}/${p}-${name}.png`, fullPage: true });
  const visit = async (url: string, name: string) => {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await shot(name);
  };

  for (const [url, name] of [
    ["/", "accueil"],
    ["/tarifs", "tarifs"],
    ["/connexion", "connexion"],
    ["/inscription", "inscription"],
    ["/mot-de-passe-oublie", "mdp-oublie"],
    ["/reinitialiser-mot-de-passe?token=" + "x".repeat(43), "mdp-reinit"],
    ["/verifier-email?token=" + "x".repeat(43), "verif-invalide"],
    ["/desabonnement?u=x&t=y", "desabonnement"],
    ["/confidentialite", "confidentialite"],
    ["/cgu", "cgu"],
    ["/mentions-legales", "mentions"],
    ["/nimporte-quoi", "404"],
  ] as const) await visit(url, name);

  // Compte de démonstration
  const email = `visite-${p}-${Date.now()}@exemple.fr`;
  await page.goto("/inscription");
  await page.getByLabel("Votre nom").fill("Claire Rousseau-Delacroix-Montaigne");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Une-Phrase-De-Passe-Solide-2026");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.waitForLoadState("networkidle");
  await shot("app-vide-non-confirme");
  await visit("/app/documents", "documents-vide");
  await visit("/app/echeances", "echeances-vide");

  // Document en attente (adresse non confirmée : l'analyse est bloquée)
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Choisir des fichiers").setInputFiles({ name: "facture-en-attente-avec-un-nom-de-fichier-tres-tres-long-2026.pdf", mimeType: "application/pdf", buffer: makePdf([["Facture 120,00 EUR"]]) });
  await page.waitForURL(/\/app\/documents\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await shot("doc-non-analyse");

  await page.goto(await verifyLink(email));
  await page.getByText("Adresse confirmée").waitFor();
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  for (const [name, lines] of [
    ["courrier-urssaf.pdf", URSSAF_LETTER],
    ["facture-piegee.pdf", INJECTION_LETTER],
  ] as const) {
    await page.getByLabel("Choisir des fichiers").setInputFiles({ name, mimeType: "application/pdf", buffer: makePdf([[...lines]]) });
    await page.waitForURL(/\/app\/documents\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await shot(`doc-${name.replace(".pdf", "")}`);
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
  }
  // Échéances manuelles : en retard, proche, sans date
  for (const [title, date] of [
    ["Déclarer le chiffre d'affaires trimestriel à l'Urssaf sur autoentrepreneur.urssaf.fr", "2026-09-30"],
    ["Renouveler l'assurance décennale", "2026-10-09"],
    ["Ranger les justificatifs de frais", ""],
  ]) {
    await page.request.post("/api/tasks", { data: { title, dueDate: date || null } });
  }
  await visit("/app", "app-rempli");
  await visit("/app/documents", "documents-liste");
  await visit("/app/documents?q=introuvable", "documents-recherche-vide");
  await visit("/app/echeances", "echeances");
  await visit("/app/echeances?vue=terminees", "echeances-terminees");
  await visit("/app/historique", "historique");
  await visit("/app/compte", "compte");
});
