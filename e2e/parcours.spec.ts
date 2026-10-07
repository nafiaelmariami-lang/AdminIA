import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { makePdf, URSSAF_LETTER } from "../tests/fixtures";

/** Lit le dernier e-mail envoyé à une adresse dans la boîte d'envoi locale (EMAIL_DRIVER=outbox). */
async function lastEmailLink(to: string, tag: string): Promise<string> {
  const dir = process.env.E2E_OUTBOX_DIR;
  if (!dir) throw new Error("E2E_OUTBOX_DIR non défini");
  for (let i = 0; i < 50; i++) {
    const files = readdirSync(dir).sort().reverse();
    for (const f of files) {
      const m = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { to: string; tag: string; text: string };
      if (m.to === to && m.tag === tag) {
        const url = /https?:\/\/\S+token=[A-Za-z0-9_-]+/.exec(m.text)?.[0];
        if (url) return new URL(url).pathname + new URL(url).search;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`aucun e-mail « ${tag} » pour ${to}`);
}

const SHOTS = process.env.E2E_SCREENSHOTS_DIR;
const shot = async (page: import("@playwright/test").Page, name: string, project: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage: true });
};

/** Toute violation de la politique de sécurité (CSP) dans la console fait échouer le test. */
function watchCsp(page: import("@playwright/test").Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(msg.text())) violations.push(msg.text());
  });
  page.on("pageerror", (err) => violations.push(`erreur JS : ${err.message}`));
  return violations;
}

test("parcours complet : inscription, ajout, analyse, échéance, recherche, isolation, export, suppression", async ({ page, browser }, info) => {
  const p = info.project.name;
  const cspViolations = watchCsp(page);
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
  await expect(page.getByText("Confirmez votre adresse e-mail")).toBeVisible();
  await shot(page, "03-tableau-de-bord-vide", p);

  // Confirmation de l'adresse e-mail (lien reçu par e-mail)
  await page.goto(await lastEmailLink(email, "verify_email"));
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.getByRole("link", { name: "Accéder à mon espace" }).click();
  await expect(page.getByText("Confirmez votre adresse e-mail")).toHaveCount(0);

  // Ajout et analyse
  await page.getByLabel("Choisir des fichiers").setInputFiles({ name: "courrier-urssaf.pdf", mimeType: "application/pdf", buffer: makePdf([URSSAF_LETTER]) });
  await expect(page).toHaveURL(/\/app\/documents\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText("Qu'est-ce que c'est ?")).toBeVisible();
  await expect(page.getByText("Pour quand ?")).toBeVisible();
  await expect(page.getByText("15 novembre 2026").first()).toBeVisible();
  await expect(page.getByText("1 234,56 €").first()).toBeVisible();
  // Moteur de démonstration (tests) : badge et avertissement explicites.
  await expect(page.getByText("Analyse de démonstration", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("IA réelle", { exact: true })).toHaveCount(0);
  const docUrl = page.url();
  await shot(page, "04-fiche-document", p);

  // Échéances
  await page.goto("/app/echeances");
  const checkbox = page.getByRole("checkbox", { name: /Marquer « Payer/ });
  await expect(checkbox).toBeVisible();
  await shot(page, "05-echeances", p);
  // Modification de l'échéance (report de date)
  await page.getByRole("button", { name: /Modifier « Payer/ }).click();
  await page.getByLabel("Date limite").first().fill("2026-11-20");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("20 novembre 2026").first()).toBeVisible();
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

  // Mise en page : aucun libellé de statistique tronqué, aucun débordement horizontal (mobile compris)
  const labels = page.getByTestId("stat-label");
  await expect(labels).toHaveCount(4);
  for (const label of await labels.all()) {
    const clipped = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `libellé tronqué : ${await label.textContent()}`).toBe(false);
  }
  await expect(page.getByText("Analyses IA restantes")).toBeVisible();
  for (const path of ["/app", docUrl, "/app/documents", "/app/echeances", "/app/compte"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `débordement horizontal sur ${path}`).toBeLessThanOrEqual(0);
  }

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

  // Le document original s'ouvre (politique isolée propre à cette route)
  const original = await page.request.get(docUrl.replace("/app/documents/", "/api/documents/") + "/file");
  expect(original.status()).toBe(200);
  expect(original.headers()["content-type"]).toBe("application/pdf");
  expect(original.headers()["content-security-policy"]).toContain("sandbox");
  expect(original.headers()["content-security-policy"]).not.toContain("frame-ancestors 'none'; sandbox");

  // CSP stricte avec nonce sur les pages, et aucune violation pendant tout le parcours
  const pageCsp = (await page.request.get("/app")).headers()["content-security-policy"] ?? "";
  expect(pageCsp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(pageCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(cspViolations).toEqual([]);

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
  const cspViolations = watchCsp(page);
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
  await page.goto("/page-inexistante");
  await expect(page.getByText("Page introuvable")).toBeVisible();
  // Un nonce différent à chaque requête
  const a = (await page.request.get("/")).headers()["content-security-policy"];
  const b = (await page.request.get("/")).headers()["content-security-policy"];
  expect(a).not.toBe(b);
  expect(cspViolations).toEqual([]);
});

test("mot de passe oublié : demande, lien par e-mail, nouveau mot de passe, connexion", async ({ page }, info) => {
  const email = `oubli-${info.project.name}-${Date.now()}@exemple.fr`;
  await page.goto("/inscription");
  await page.getByLabel("Votre nom").fill("Dominique");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Ancienne-Phrase-Secrete-1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.context().clearCookies();

  await page.goto("/connexion");
  await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
  await page.getByLabel("Adresse e-mail du compte").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien de réinitialisation" }).click();
  await expect(page.getByText(/Si un compte existe/)).toBeVisible();

  await page.goto(await lastEmailLink(email, "reset_password"));
  await page.getByLabel("Nouveau mot de passe").fill("Nouvelle-Phrase-Secrete-2");
  await page.getByLabel("Confirmez le mot de passe").fill("Nouvelle-Phrase-Secrete-2");
  await page.getByRole("button", { name: "Enregistrer et me connecter" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.context().clearCookies();
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Nouvelle-Phrase-Secrete-2");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
