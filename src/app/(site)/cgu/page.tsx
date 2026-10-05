import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Conditions générales d'utilisation" };

export default function TermsPage() {
  return (
    <LegalPage title="Conditions générales d'utilisation" updated="5 octobre 2026">
      <h2>1. Objet</h2>
      <p>
        Les présentes conditions régissent l&apos;utilisation du service AdminIA édité par [Raison sociale]. AdminIA permet de stocker des documents
        administratifs, d&apos;en obtenir une analyse automatisée (résumé, informations clés, actions et échéances) et d&apos;organiser leur suivi.
      </p>

      <h2>2. Nature du service — absence de conseil</h2>
      <p>
        AdminIA est un outil d&apos;aide à la compréhension et à l&apos;organisation. <strong>Il ne fournit pas de conseil juridique, fiscal, social ou
        comptable</strong> et ne remplace pas un avocat, un expert-comptable ou tout autre professionnel réglementé. Les analyses sont produites
        automatiquement par une intelligence artificielle et <strong>peuvent comporter des erreurs ou omissions</strong>. L&apos;utilisateur doit vérifier les
        informations importantes (montants, dates, obligations) sur le document original et reste seul responsable des décisions prises.
      </p>

      <h2>3. Compte</h2>
      <p>
        L&apos;utilisateur s&apos;engage à fournir des informations exactes et à préserver la confidentialité de son mot de passe. Le service est destiné aux
        professionnels (indépendants, entreprises) [préciser si les consommateurs sont acceptés].
      </p>

      <h2>4. Formules, quotas et prix</h2>
      <p>
        Le service est proposé selon les formules décrites sur la page Tarifs. Chaque formule comporte un nombre d&apos;analyses mensuelles et une capacité de
        stockage. Des limites techniques (taille, nombre de pages, fréquence) s&apos;appliquent afin de garantir la qualité et la sécurité du service. [Conditions
        de paiement, de renouvellement, de résiliation et de remboursement à compléter lors de l&apos;activation du paiement.]
      </p>

      <h2>5. Utilisation acceptable</h2>
      <ul>
        <li>Ne déposer que des documents que l&apos;utilisateur est en droit de détenir et de traiter.</li>
        <li>Ne pas tenter de contourner les limites, d&apos;accéder aux données d&apos;autrui, ni de détourner l&apos;intelligence artificielle.</li>
        <li>Ne pas utiliser le service à des fins illicites.</li>
      </ul>
      <p>Tout manquement peut entraîner la suspension du compte.</p>

      <h2>6. Données et propriété</h2>
      <p>
        L&apos;utilisateur reste propriétaire de ses documents. Il accorde à [Raison sociale] une licence limitée au strict nécessaire pour fournir le service.
        Les documents ne sont pas utilisés pour entraîner des modèles d&apos;intelligence artificielle. Voir la Politique de confidentialité.
      </p>

      <h2>7. Disponibilité</h2>
      <p>
        [Raison sociale] s&apos;efforce d&apos;assurer la disponibilité du service sans garantie d&apos;absence d&apos;interruption. Certaines fonctions (notamment
        l&apos;analyse automatique) peuvent être temporairement suspendues pour maintenance, sécurité ou maîtrise des coûts ; les documents restent alors
        accessibles. Il est recommandé de conserver ses documents originaux.
      </p>

      <h2>8. Responsabilité</h2>
      <p>
        [Clause de limitation de responsabilité à rédiger par un juriste, compatible avec le droit applicable, notamment au regard des erreurs d&apos;analyse
        et des échéances manquées.]
      </p>

      <h2>9. Résiliation</h2>
      <p>L&apos;utilisateur peut supprimer son compte à tout moment depuis son espace. Les données sont alors effacées définitivement.</p>

      <h2>10. Droit applicable</h2>
      <p>Droit français. [Clause d&apos;attribution de juridiction et médiation à compléter.]</p>
    </LegalPage>
  );
}
