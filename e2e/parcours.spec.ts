import { expect, test } from "@playwright/test";
import { makePdf, URSSAF_LETTER } from "../tests/fixtures";

const SHOTS = process.env.E2E_SCREENSHOTS_DIR;
const shot = async (page: import("@playwright/test").Page, name: string, project: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage: true });
};

test("parcours complet : inscription, ajout, analyse, échéance, recherche, isolation, export, suppression", async ({ page, browser }, info) => {
  const p = info.project.name;
  const email = `e2e-${p}-${Date.now()}@exemple.fr`;
  const password = "Une-Phrase-De-Passe-Solide-2026";

  // Accueil
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("enfin compris");
  await shot(page, "01-accueil", p);

  // Inscription
  await page.getByRole("link", { name: "Essai gratuit" }).first().click();
  await page.getByLabel("Votre nom").fill("Camille Martin");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("checkbox").check();
  await shot(page, "02-inscription", p);
  await page.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: /Bonjour Camille/ })).toBeVisible();
  await shot(page, "03-tableau-de-bord-vide", p);

  // Ajout et analyse
  await page.getByLabel("Choisir des fichiers").setInputFiles({ name: "courrier-urssaf.pdf", mimeType: "application/pdf", buffer: makePdf([URSSAF_LETTER]) });
  await expect(page).toHaveURL(/\/app\/documents\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText("Qu'est-ce que c'est ?")).toBeVisible();
  await expect(page.getByText("Pour quand ?")).toBeVisible();
  await expect(page.getByText("15 novembre 2026").first()).toBeVisible();
  await expect(page.getByText("1 234,56 €").first()).toBeVisible();
  const docUrl = page.url();
  await shot(page, "04-fiche-document", p);

  // Échéances
  await page.goto("/app/echeances");
  const checkbox = page.getByRole("checkbox", { name: /Marquer « Payer/ });
  await expect(checkbox).toBeVisible();
  await shot(page, "05-echeances", p);
  await checkbox.click();
  await expect(page.getByText("Aucune échéance à faire")).toBeVisible();

  // Recherche
  await page.goto("/app/documents");
  await page.getByPlaceholder(/Rechercher/).fill("cotisation");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByText("1 document pour « cotisation »")).toBeVisible();
  await shot(page, "06-recherche", p);

  // Tableau de bord rempli
  await page.goto("/app");
  await shot(page, "07-tableau-de-bord", p);

  // Isolation : un autre utilisateur ne voit pas le document
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/inscription");
  await otherPage.getByLabel("Votre nom").fill("Intrus");
  await otherPage.getByLabel("Adresse e-mail").fill(`intrus-${p}-${Date.now()}@exemple.fr`);
  await otherPage.getByLabel("Mot de passe").fill(password);
  await otherPage.getByRole("checkbox").check();
  await otherPage.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(otherPage).toHaveURL(/\/app$/);
  await otherPage.goto(docUrl);
  await expect(otherPage.getByText("Page introuvable")).toBeVisible();
  const fileRes = await otherPage.request.get(docUrl.replace("/app/documents/", "/api/documents/") + "/file");
  expect(fileRes.status()).toBe(404);
  await other.close();

  // Compte : export
  await page.goto("/app/compte");
  await shot(page, "08-compte", p);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Télécharger l'export/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^adminia-export-.*\.zip$/);

  // Suppression du compte
  await page.getByRole("button", { name: "Supprimer mon compte…" }).click();
  await page.getByLabel("Votre mot de passe").fill(password);
  await page.getByLabel("Tapez SUPPRIMER pour confirmer").fill("SUPPRIMER");
  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/connexion$/);
});

test("les pages publiques et légales sont accessibles", async ({ page }) => {
  for (const [path, text] of [
    ["/tarifs", "Tarifs"],
    ["/confidentialite", "Politique de confidentialité"],
    ["/cgu", "Conditions générales d'utilisation"],
    ["/mentions-legales", "Mentions légales"],
    ["/connexion", "Bon retour"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(text);
  }
  await expect(page.locator("body")).not.toContainText("undefined");
});
