/**
 * Confirme manuellement l'adresse e-mail d'un compte, depuis le serveur (bêta sans e-mail).
 * Utile pour le PREMIER administrateur, qui ne peut pas confirmer sa propre adresse sans e-mail.
 *   npm run account:verify-email -- vous@exemple.fr           → affiche le compte (simulation)
 *   npm run account:verify-email -- vous@exemple.fr --apply   → confirme l'adresse
 * Ne confirmez qu'un compte que vous avez créé vous-même (vérifiez la date de création affichée).
 * Ne touche ni au mot de passe, ni aux sessions, ni aux documents.
 */
import { getDb } from "@/server/db";
import { verifyEmailFromCli } from "@/server/admin/service";

async function main() {
  const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!email) {
    console.error("Usage : npm run account:verify-email -- <adresse> [--apply]");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const r = await verifyEmailFromCli(await getDb(), email, { apply });
  if (!r.found) {
    console.error("Aucun compte avec cette adresse.");
    process.exit(1);
  }
  console.log(`Compte : ${r.user.email} (${r.user.name}), créé le ${r.user.createdAt.toISOString()}`);
  if (r.user.emailVerifiedAt) console.log(`Adresse déjà confirmée le ${r.user.emailVerifiedAt.toISOString()}.`);
  else if (r.changed) console.log("Adresse confirmée (action journalisée).");
  else console.log("Simulation : rien n'a été modifié. Relancez avec --apply pour confirmer cette adresse.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
