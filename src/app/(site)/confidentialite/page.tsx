import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" updated="5 octobre 2026">
      <p>
        Cette politique explique comment [Raison sociale] (« AdminIA », « nous ») traite vos données personnelles lorsque vous utilisez le service AdminIA,
        conformément au Règlement général sur la protection des données (RGPD) et à la loi Informatique et Libertés.
      </p>

      <h2>1. Responsable du traitement</h2>
      <p>[Raison sociale], [forme juridique], [adresse], SIREN [numéro]. Contact : [adresse e-mail dédiée à la protection des données].</p>

      <h2>2. Données traitées</h2>
      <ul>
        <li><strong>Compte</strong> : nom, adresse e-mail, mot de passe (stocké uniquement sous forme hachée), formule choisie.</li>
        <li><strong>Documents</strong> que vous déposez et leur contenu (qui peut inclure des données financières, fiscales ou sociales), ainsi que les analyses générées.</li>
        <li><strong>Échéances</strong> et actions que vous créez ou que l&apos;analyse propose.</li>
        <li><strong>Journal d&apos;activité</strong> : connexions, ajouts, analyses, suppressions (sans le contenu des documents).</li>
        <li><strong>Données techniques</strong> : consommation des analyses et coûts associés, à des fins de facturation et de sécurité.</li>
      </ul>
      <p>
        Nous vous recommandons de ne pas déposer de documents contenant des données de santé ou d&apos;autres données sensibles qui ne sont pas nécessaires à votre
        gestion administrative.
      </p>

      <h2>3. Finalités et bases légales</h2>
      <table>
        <thead>
          <tr><th>Finalité</th><th>Base légale</th></tr>
        </thead>
        <tbody>
          <tr><td>Fournir le service (stockage, analyse, échéancier, recherche)</td><td>Exécution du contrat</td></tr>
          <tr><td>Sécurité, prévention des abus et de la fraude</td><td>Intérêt légitime</td></tr>
          <tr><td>Facturation et obligations comptables</td><td>Obligation légale</td></tr>
          <tr><td>Amélioration du service (statistiques agrégées)</td><td>Intérêt légitime</td></tr>
        </tbody>
      </table>

      <h2>4. Intelligence artificielle</h2>
      <p>
        Pour analyser un document, son contenu est transmis à notre sous-traitant d&apos;intelligence artificielle, Anthropic (modèles Claude). Selon ses
        conditions commerciales, les données transmises via son API <strong>ne sont pas utilisées pour entraîner ses modèles</strong>. [Préciser la durée de
        conservation applicable chez le sous-traitant et les garanties contractuelles en vigueur.] L&apos;analyse est automatisée mais ne produit aucune décision
        ayant un effet juridique à votre égard : vous restez seul décisionnaire.
      </p>

      <h2>5. Destinataires et sous-traitants</h2>
      <ul>
        <li>Hébergement de l&apos;application et de la base de données : [hébergeur, localisation — UE recommandée].</li>
        <li>Stockage des fichiers : [prestataire, localisation].</li>
        <li>Analyse par IA : Anthropic PBC (États-Unis).</li>
        <li>Paiement (lorsqu&apos;il sera activé) : [prestataire de paiement].</li>
      </ul>
      <p>Nous ne vendons jamais vos données et ne les partageons pas à des fins publicitaires.</p>

      <h2>6. Transferts hors de l&apos;Union européenne</h2>
      <p>
        L&apos;analyse par IA peut impliquer un transfert vers les États-Unis. Ce transfert est encadré par [le cadre de protection des données UE–États-Unis et/ou
        des clauses contractuelles types de la Commission européenne — à confirmer].
      </p>

      <h2>7. Durées de conservation</h2>
      <ul>
        <li>Documents, analyses et échéances : tant que votre compte est actif, ou jusqu&apos;à ce que vous les supprimiez.</li>
        <li>Compte inactif : suppression après 24 mois d&apos;inactivité, après information préalable.</li>
        <li>Journal d&apos;activité : 12 mois.</li>
        <li>Journaux de coûts d&apos;analyse : 12 mois, anonymisés à la suppression du compte.</li>
        <li>Données de facturation : 10 ans (obligation légale).</li>
      </ul>

      <h2>8. Sécurité</h2>
      <p>
        Chiffrement des fichiers au repos (AES-256), connexions chiffrées (HTTPS), mots de passe hachés (Argon2id), cloisonnement strict entre comptes,
        journalisation des accès, limitation des tentatives de connexion.
      </p>

      <h2>9. Vos droits</h2>
      <p>
        Vous disposez des droits d&apos;accès, de rectification, d&apos;effacement, de limitation, d&apos;opposition et de portabilité. Depuis votre espace « Compte »,
        vous pouvez <strong>exporter toutes vos données</strong> et <strong>supprimer définitivement votre compte</strong>. Pour toute autre demande : [adresse
        e-mail]. Vous pouvez également introduire une réclamation auprès de la CNIL (www.cnil.fr).
      </p>

      <h2>10. Cookies</h2>
      <p>
        AdminIA utilise uniquement un cookie strictement nécessaire à la connexion (session). Aucun cookie publicitaire ni de mesure d&apos;audience tierce
        n&apos;est déposé, ce qui ne nécessite pas de bandeau de consentement.
      </p>
    </LegalPage>
  );
}
