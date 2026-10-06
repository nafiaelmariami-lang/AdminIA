import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

async function lastEmailLink(to: string, tag: string): Promise<string> {
  const dir = process.env.E2E_OUTBOX_DIR;
  if (!dir) throw new Error("E2E_OUTBOX_DIR non défini");
  for (let i = 0; i < 50; i++) {
    for (const f of readdirSync(dir).sort().reverse()) {
      const m = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { to: string; tag: string; text: string };
      const url = m.to === to && m.tag === tag ? /https?:\/\/\S+token=[A-Za-z0-9_-]+/.exec(m.text)?.[0] : undefined;
      if (url) return new URL(url).pathname + new URL(url).search;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`aucun e-mail « ${tag} » pour ${to}`);
}

/**
 * Nécessite ADMIN_EMAILS=e2e-admin-desktop@exemple.fr,e2e-admin-mobile@exemple.fr côté serveur.
 * Le compte administrateur est supprimé en fin de test (le test peut être relancé).
 */
function totp(base32: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/\s/g, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac("sha1", key).update(msg).digest();
  return String((h.readUInt32BE(h[h.length - 1]! & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("administration : réservée, 2FA exigée, statistiques, interrupteurs, formule d'un testeur", async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const email = `e2e-admin-${info.project.name}@exemple.fr`;
  const password = "Une-Phrase-De-Passe-Solide-2026";

  // Un utilisateur ordinaire ne voit ni le lien ni la page.
  const other = await browser.newPage();
  await other.goto("/inscription");
  await other.waitForLoadState("networkidle");
  await other.getByLabel("Votre nom").fill("Testeur");
  const testerEmail = `testeur-${info.project.name}-${Date.now()}@exemple.fr`;
  await other.getByLabel("Adresse e-mail").fill(testerEmail);
  await other.getByLabel("Mot de passe").fill(password);
  await other.getByRole("checkbox").check();
  await other.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(other).toHaveURL(/\/app$/);
  await expect(other.getByRole("link", { name: "Administration" })).toHaveCount(0);
  // notFound() en rendu diffusé : page 404 affichée (le statut HTTP peut rester 200), aucune donnée d'administration.
  const html = await (await other.goto("/app/admin"))!.text();
  await expect(other.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  expect(html).not.toMatch(/Interrupteurs|Journal d'administration|Utilisateurs \(/);
  await other.close();

  // Administrateur : inscription, puis double authentification exigée.
  await page.goto("/inscription");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Votre nom").fill("Admin");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(await lastEmailLink(email, "verify_email"));
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.goto("/app/admin");
  await expect(page.getByText(/exige la double authentification/)).toBeVisible();

  await page.goto("/app/compte");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Activer la double authentification" }).click();
  const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).textContent())!;
  await page.getByLabel("Code à 6 chiffres").fill(totp(secret));
  await page.getByRole("button", { name: "Confirmer l'activation" }).click();
  await page.getByRole("button", { name: "J'ai noté mes codes" }).click();

  try {
    await page.goto("/app/admin");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();
    await expect(page.getByText("Comptes", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (process.env.E2E_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS_DIR}/${info.project.name}-admin.png`, fullPage: true });

    // Interrupteur : fermer puis rouvrir les inscriptions.
    const sw = page.getByRole("switch", { name: "Inscriptions" });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    // Formule d'un testeur
    await page.getByLabel("Rechercher un utilisateur").fill(testerEmail);
    await page.getByRole("button", { name: "Rechercher" }).click();
    // Cellule « Compte » (l'adresse apparaît aussi dans le bouton « Confirmer l'adresse de … »).
    await expect(page.getByRole("cell", { name: new RegExp(`^${testerEmail.replace(/[.]/g, "\\.")}`) })).toBeVisible();
    await page.getByLabel(`Formule de ${testerEmail}`).selectOption("pro");
    await expect(page.getByText("Formule modifiée").first()).toBeVisible();
    await expect(page.getByText(new RegExp(`Découverte → Pro.*${testerEmail.replace(/[.]/g, "\\.")}`))).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    // Nettoyage : l'adresse d'administration de test redevient libre.
    await page.request.delete("/api/account", { data: { password, confirm: "SUPPRIMER" }, headers: { origin: new URL(page.url()).origin } });
  }
});
