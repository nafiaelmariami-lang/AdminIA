import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Mentions légales" };

export default function LegalNoticePage() {
  return (
    <LegalPage title="Mentions légales" updated="5 octobre 2026">
      <h2>Éditeur</h2>
      <p>
        [Raison sociale], [forme juridique] au capital de [montant] €<br />
        Siège : [adresse]<br />
        SIREN / RCS : [numéro] — TVA intracommunautaire : [numéro]<br />
        Directeur de la publication : [nom]<br />
        Contact : [adresse e-mail] — [téléphone]
      </p>
      <h2>Hébergement</h2>
      <p>[Nom de l&apos;hébergeur], [adresse], [téléphone].</p>
      <h2>Propriété intellectuelle</h2>
      <p>La marque, le logo et les contenus du site AdminIA sont la propriété de [Raison sociale]. [Vérifier la disponibilité de la marque « AdminIA » auprès de l&apos;INPI.]</p>
      <h2>Données personnelles</h2>
      <p>Voir la Politique de confidentialité.</p>
    </LegalPage>
  );
}
