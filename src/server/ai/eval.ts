import type { DocumentAnalysis } from "./schema";

/** Score d'une analyse face aux attentes d'un cas d'évaluation (voir evals/cases.ts). */
export type EvalExpected = {
  categorie?: string;
  type_document?: string;
  montant_a_payer?: number | null;
  echeance?: string;
  urgence_min?: "faible" | "moyen" | "eleve" | "critique";
  aucune_action?: boolean;
  suspect?: boolean;
};

const URGENCY_RANK = { faible: 0, moyen: 1, eleve: 2, critique: 3 } as const;

export function scoreAnalysis(expected: EvalExpected, a: DocumentAnalysis): { checks: Record<string, boolean>; passed: number; total: number } {
  const checks: Record<string, boolean> = {};
  if (expected.categorie !== undefined) checks.categorie = a.categorie === expected.categorie;
  if (expected.type_document !== undefined) checks.type_document = a.type_document === expected.type_document;
  if (expected.montant_a_payer !== undefined) {
    checks.montant_a_payer =
      expected.montant_a_payer === null ? a.montant_a_payer === null : a.montant_a_payer !== null && Math.abs(a.montant_a_payer - expected.montant_a_payer) < 0.01;
  }
  if (expected.echeance !== undefined) {
    const dates = new Set([...a.echeances.map((e) => e.date), ...a.actions_requises.map((x) => x.echeance).filter(Boolean)]);
    checks.echeance = dates.has(expected.echeance);
  }
  if (expected.urgence_min !== undefined) checks.urgence = URGENCY_RANK[a.niveau_urgence] >= URGENCY_RANK[expected.urgence_min];
  if (expected.aucune_action !== undefined) checks.aucune_action = a.aucune_action_requise === expected.aucune_action;
  if (expected.suspect !== undefined) checks.suspect = a.contenu_suspect === expected.suspect;
  const values = Object.values(checks);
  return { checks, passed: values.filter(Boolean).length, total: values.length };
}
