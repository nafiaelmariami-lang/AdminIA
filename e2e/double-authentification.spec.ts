import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** Générateur TOTP (RFC 6238) indépendant du code de l'application, comme le ferait un téléphone. */
function totp(base32: string, offset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/\s/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/connexion");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Double authentification" })).toBeVisible();
}

test("double authentification : activation, connexion avec code, code de secours, désactivation", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const email = `2fa-${info.project.name}-${Date.now()}@exemple.fr`;
  const password = "Une-Phrase-De-Passe-Solide-2026";

  await page.goto("/inscription");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Votre nom").fill("Alex");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte gratuit" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Activation
  await page.goto("/app/compte");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Activer la double authentification" }).click();
  const qr = page.getByRole("img", { name: "QR code à scanner avec l'application" });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).textContent())!;
  await page.getByLabel("Code à 6 chiffres").fill(totp(secret));
  await page.getByRole("button", { name: "Confirmer l'activation" }).click();
  const list = page.getByRole("list", { name: "Codes de secours" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const recovery = (await list.getByRole("listitem").nth(0).textContent())!.trim();
  const recovery2 = (await list.getByRole("listitem").nth(1).textContent())!.trim();
  await page.getByRole("button", { name: "J'ai noté mes codes" }).click();
  await expect(page.getByText("Activée", { exact: true })).toBeVisible();

  // Connexion : le mot de passe seul ne suffit pas ; un code faux est refusé.
  await login(page, email, password);
  await page.getByLabel(/Code à 6 chiffres/).fill(totp(secret, 1) === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Code incorrect.")).toBeVisible();
  await page.getByLabel(/Code à 6 chiffres/).fill(totp(secret, 1));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Code de secours
  await login(page, email, password);
  await page.getByRole("button", { name: /Utiliser un code de secours/ }).click();
  await page.getByLabel("Code de secours").fill(recovery);
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Désactivation (mot de passe + code de secours suivant)
  await page.goto("/app/compte");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Codes de secours restants : 9 / 10")).toBeVisible();
  await page.getByRole("button", { name: "Désactiver…" }).click();
  await page.getByLabel("Votre mot de passe").first().fill(password);
  await page.getByLabel("Code de l'application (ou code de secours)").fill(recovery);
  await page.getByRole("button", { name: "Désactiver", exact: true }).click();
  await expect(page.getByText("Code incorrect.")).toBeVisible(); // code de secours déjà utilisé
  const second = await page.request.get("/api/account/2fa");
  expect(((await second.json()) as { enabled: boolean }).enabled).toBe(true);
  await page.getByLabel("Code de l'application (ou code de secours)").fill(recovery2);
  await page.getByRole("button", { name: "Désactiver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activer la double authentification" })).toBeVisible();

  expect(errors).toEqual([]);
});
