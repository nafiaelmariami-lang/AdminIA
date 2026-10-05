/** Libellés et couleurs affichés à l'utilisateur (aucune logique de sécurité ici). */

export const CATEGORY_LABELS: Record<string, string> = {
  urssaf: "Urssaf",
  impots: "Impôts",
  caf: "CAF",
  sante_social: "Santé / social",
  assurance: "Assurance",
  banque: "Banque",
  fournisseur: "Fournisseur",
  client: "Client",
  juridique: "Juridique",
  autre: "Autre",
};

export const CATEGORY_COLORS: Record<string, string> = {
  urssaf: "bg-sky-100 text-sky-800",
  impots: "bg-indigo-100 text-indigo-800",
  caf: "bg-teal-100 text-teal-800",
  sante_social: "bg-emerald-100 text-emerald-800",
  assurance: "bg-violet-100 text-violet-800",
  banque: "bg-slate-200 text-slate-800",
  fournisseur: "bg-amber-100 text-amber-800",
  client: "bg-lime-100 text-lime-800",
  juridique: "bg-rose-100 text-rose-800",
  autre: "bg-gray-100 text-gray-700",
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  courrier_administratif: "Courrier administratif",
  appel_cotisations: "Appel de cotisations",
  avis_imposition: "Avis d'imposition",
  mise_en_demeure: "Mise en demeure",
  relance: "Relance",
  facture: "Facture",
  devis: "Devis",
  contrat: "Contrat",
  attestation: "Attestation",
  releve_bancaire: "Relevé bancaire",
  avis_echeance: "Avis d'échéance",
  autre: "Autre document",
};

export const URGENCY: Record<string, { label: string; className: string; dot: string }> = {
  critique: { label: "Urgent", className: "bg-red-100 text-red-800 ring-red-200", dot: "bg-red-500" },
  eleve: { label: "Important", className: "bg-orange-100 text-orange-800 ring-orange-200", dot: "bg-orange-500" },
  moyen: { label: "À prévoir", className: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-400" },
  faible: { label: "Pour information", className: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
};

export const STATUS_LABELS: Record<string, string> = {
  uploaded: "En attente d'analyse",
  processing: "Analyse en cours…",
  analyzed: "Analysé",
  failed: "Analyse échouée",
};

export const PRIORITY_LABELS: Record<string, string> = { haute: "Priorité haute", moyenne: "Priorité normale", basse: "Priorité basse" };

export const ACTIVITY_LABELS: Record<string, string> = {
  "account.created": "Création du compte",
  "auth.login": "Connexion",
  "auth.logout": "Déconnexion",
  "document.uploaded": "Document ajouté",
  "document.analyzed": "Document analysé",
  "document.analysis_failed": "Échec d'analyse",
  "document.updated": "Document modifié",
  "document.deleted": "Document supprimé",
  "task.created": "Échéance ajoutée",
  "task.completed": "Échéance terminée",
  "task.reopened": "Échéance rouverte",
  "task.deleted": "Échéance supprimée",
  "account.exported": "Export des données",
  "account.email_verified": "Adresse e-mail confirmée",
  "account.password_reset_requested": "Demande de réinitialisation du mot de passe",
  "account.password_changed": "Mot de passe modifié",
};
