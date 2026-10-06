import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { makePdf, URSSAF_LETTER } from "../tests/fixtures";

/**
 * Bêta sans e-mail (EMAIL_DRIVER=disabled) : lancé seulement avec
 *   E2E_EMAIL_DRIVER=disabled scripts/e2e-local.sh beta-sans-email
 * Le premier administrateur est confirmé par la commande serveur, comme sur le VPS.
 */
test.skip(!process.env.E2E_EMAIL_DISABLED, "nécessite un serveur lancé avec EMAIL_DRIVER=disabled");

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

async function register(page: Page, name: string, email: string, password: string) {
  await page.goto("/inscription");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Votre nom").fill(name);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("bêta sans e-mail : messages honnêtes, confirmation par l'administrateur, puis analyse", async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const password = "Une-Phrase-De-Passe-Solide-2026";
  const adminEmail = `e2e-admin-${info.project.name}@exemple.fr`;
  const testerEmail = `testeur-sans-email-${info.project.name}-${Date.now()}@exemple.fr`;

  // 1. Le testeur : aucun « lien envoyé », pas de bouton de renvoi, analyse en attente de l'équipe.
  const tester = await browser.newPage();
  await register(tester, "Testeur", testerEmail, password);
  await expect(tester.getByText("Adresse e-mail à confirmer par l'équipe AdminIA.")).toBeVisible();
  await expect(tester.getByText(/aucun\s+lien ne vous a été envoyé/)).toBeVisible();
  await expect(tester.getByRole("button", { name: "Renvoyer le lien" })).toHaveCount(0);
  await tester.getByLabel("Choisir des fichiers").setInputFiles({ name: "courrier.pdf", mimeType: "application/pdf", buffer: makePdf([URSSAF_LETTER]) });
  await expect(tester.getByText(/dès que l'équipe AdminIA aura confirmé votre adresse/).first()).toBeVisible({ timeout: 30_000 });

  // Mot de passe oublié : explication, aucun formulaire qui prétendrait envoyer un lien.
  const anon = await browser.newPage();
  await anon.goto("/mot-de-passe-oublie");
  await expect(anon.getByText("Réinitialisation par e-mail indisponible pour le moment")).toBeVisible();
  await expect(anon.getByRole("button", { name: "Recevoir un lien de réinitialisation" })).toHaveCount(0);
  await anon.close();

  // 2. Le premier administrateur : confirmé depuis le serveur, puis double authentification.
  await register(page, "Admin", adminEmail, password);
  try {
    execFileSync("npm", ["run", "-s", "account:verify-email", "--", adminEmail, "--apply"], { stdio: "pipe" });
    await page.goto("/app/compte");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Activer la double authentification" }).click();
    const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).textContent())!;
    await page.getByLabel("Code à 6 chiffres").fill(totp(secret));
    await page.getByRole("button", { name: "Confirmer l'activation" }).click();
    await page.getByRole("button", { name: "J'ai noté mes codes" }).click();

    // 3. L'administrateur confirme le testeur.
    await page.goto("/app/admin");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Envoi d'e-mails désactivé")).toBeVisible();
    await page.getByLabel("Rechercher un utilisateur").fill(testerEmail);
    await page.getByRole("button", { name: "Rechercher" }).click();
    await page.getByRole("button", { name: `Confirmer l'adresse de ${testerEmail}` }).click();
    await expect(page.getByText("Adresse confirmée manuellement").first()).toBeVisible();
    await expect(page.getByRole("button", { name: `Confirmer l'adresse de ${testerEmail}` })).toHaveCount(0);

    // 4. Le testeur peut lancer l'analyse.
    await tester.goto("/app/documents");
    await tester.getByRole("link", { name: /courrier|Appel de cotisations/i }).first().click();
    await tester.getByRole("button", { name: "Analyser ce document" }).click();
    await expect(tester.getByText("Qu'est-ce que c'est ?")).toBeVisible({ timeout: 30_000 });
    await expect(tester.getByText("Adresse e-mail à confirmer par l'équipe AdminIA.")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete("/api/account", { data: { password, confirm: "SUPPRIMER" }, headers: { origin: new URL(page.url()).origin } });
    await tester.close();
  }
});
