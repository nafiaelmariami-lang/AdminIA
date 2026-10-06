import { expect, test } from "@playwright/test";
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

test("changement d'adresse e-mail : demande, confirmation, connexion, annulation depuis l'ancienne adresse", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const stamp = `${info.project.name}-${Date.now()}`;
  const oldEmail = `ancienne-${stamp}@exemple.fr`;
  const newEmail = `nouvelle-${stamp}@exemple.fr`;
  const password = "Une-Phrase-De-Passe-Solide-2026";

  await page.goto("/inscription");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Votre nom").fill("Sacha");
  await page.getByLabel("Adresse e-mail").fill(oldEmail);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/compte");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Changer mon adresse e-mail" }).click();
  await page.getByLabel("Nouvelle adresse e-mail").fill(newEmail);
  await page.getByLabel("Mot de passe actuel").fill(password);
  await page.getByRole("button", { name: "Envoyer le lien de confirmation" }).click();
  await expect(page.getByText(/un lien de confirmation vient d'y être envoyé/)).toBeVisible();

  await page.goto(await lastEmailLink(newEmail, "confirm_new_email"));
  await expect(page.getByText("Adresse modifiée")).toBeVisible();
  await page.getByRole("link", { name: "Aller à mon compte" }).click();
  await expect(page.getByText(newEmail).first()).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/connexion");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Adresse e-mail").fill(newEmail);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // L'ancienne adresse annule : l'ouverture du lien seule ne fait rien, il faut cliquer.
  await page.goto(await lastEmailLink(oldEmail, "email_changed"));
  await page.getByRole("button", { name: "Annuler le changement et sécuriser mon compte" }).click();
  await expect(page.getByText("Changement annulé")).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/connexion$/);
  expect(errors).toEqual([]);
});
