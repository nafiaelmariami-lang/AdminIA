import type { RawAnalysis } from "./schema";
import { normalizeDate } from "./schema";
import type { AiProvider, AnalysisInput, AnalysisOutput } from "./types";

/**
 * Fournisseur de démonstration : analyse heuristique locale, sans appel externe ni coût.
 * Utilisé en développement sans clé API et dans les tests. Il n'a pas la qualité d'un vrai modèle :
 * l'interface affiche un bandeau « mode démonstration ».
 */

const ORGANISMS: { re: RegExp; name: string; category: RawAnalysis["categorie"] }[] = [
  { re: /\burssaf\b/i, name: "Urssaf", category: "urssaf" },
  { re: /\b(dgfip|impots\.gouv|finances publiques|avis d'imp[oô]t|cotisation fonci[eè]re)\b/i, name: "Direction générale des Finances publiques", category: "impots" },
  { re: /\b(caf|allocations familiales)\b/i, name: "CAF", category: "caf" },
  { re: /\b(cpam|assurance maladie|mutuelle)\b/i, name: "Assurance maladie", category: "sante_social" },
  { re: /\b(assurance|assureur|sinistre|police n)/i, name: "Assureur", category: "assurance" },
  { re: /\b(banque|bancaire|cr[ée]dit agricole|bnp|soci[ée]t[ée] g[ée]n[ée]rale|lcl|caisse d'[ée]pargne)\b/i, name: "Banque", category: "banque" },
];

const DATE_RE = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
const AMOUNT_RE = /(\d{1,3}(?:[  .]\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)\s?(?:€|eur(?:os)?)\b/gi;
const DEADLINE_HINT = /(avant le|au plus tard le|date limite|[ée]ch[ée]ance|exigible le|à r[ée]gler avant|payer avant)\s*:?\s*$/i;

function parseAmount(s: string): number {
  return Number(s.replace(/[  .]/g, "").replace(",", "."));
}

export function mockAnalyze(input: AnalysisInput): RawAnalysis {
  const text = input.text ?? "";
  const org = ORGANISMS.find((o) => o.re.test(text));
  const lower = text.toLowerCase();

  let type: RawAnalysis["type_document"] = "courrier_administratif";
  if (/mise en demeure/.test(lower)) type = "mise_en_demeure";
  else if (/\bfacture\b/.test(lower)) type = "facture";
  else if (/\bdevis\b/.test(lower)) type = "devis";
  else if (/\bcontrat\b/.test(lower)) type = "contrat";
  else if (/appel de cotisations|cotisations/.test(lower)) type = "appel_cotisations";
  else if (/avis d'imp[oô]t/.test(lower)) type = "avis_imposition";
  else if (/\battestation\b/.test(lower)) type = "attestation";
  else if (/\brelance\b/.test(lower)) type = "relance";

  const dates: { date: string; libelle: string }[] = [];
  const echeances: RawAnalysis["echeances"] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const iso = normalizeDate(`${m[1]}/${m[2]}/${m[3]}`);
    if (!iso) continue;
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (DEADLINE_HINT.test(before)) echeances.push({ date: iso, libelle: "Date limite indiquée dans le document", type: type === "facture" || type === "appel_cotisations" ? "paiement" : "autre" });
    else dates.push({ date: iso, libelle: "Date mentionnée" });
  }

  const montants: RawAnalysis["montants"] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const value = parseAmount(m[1] ?? "");
    if (Number.isFinite(value) && value > 0) montants.push({ libelle: "Montant mentionné", montant: value, devise: "EUR", sens: "information" });
  }
  const largest = montants.reduce<number | null>((acc, m) => (acc === null || m.montant > acc ? m.montant : acc), null);
  const toPay = ["facture", "appel_cotisations", "mise_en_demeure", "relance", "avis_imposition"].includes(type) ? largest : null;

  const actions: RawAnalysis["actions_requises"] = [];
  const firstDeadline = echeances[0]?.date ?? null;
  if (toPay !== null) actions.push({ action: `Payer ${toPay.toFixed(2).replace(".", ",")} €`, echeance: firstDeadline, priorite: "haute" });
  else if (firstDeadline) actions.push({ action: "Traiter ce document avant la date limite", echeance: firstDeadline, priorite: "moyenne" });

  const urgency: RawAnalysis["niveau_urgence"] = type === "mise_en_demeure" ? "critique" : actions.length > 0 ? "eleve" : "faible";
  const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 280);

  return {
    titre: `${type === "courrier_administratif" ? "Courrier" : type.replace(/_/g, " ")}${org ? ` — ${org.name}` : ""}`.replace(/^./, (c) => c.toUpperCase()),
    type_document: type,
    categorie: org?.category ?? (type === "facture" || type === "devis" ? "fournisseur" : "autre"),
    organisme: org?.name ?? null,
    date_document: dates[0]?.date ?? null,
    reference: /r[ée]f[ée]rence\s*:?\s*([A-Z0-9-]{4,30})/i.exec(text)?.[1] ?? null,
    entreprise: null,
    personnes: [],
    montants,
    montant_a_payer: toPay,
    dates_importantes: dates,
    echeances,
    actions_requises: actions,
    aucune_action_requise: actions.length === 0,
    niveau_urgence: urgency,
    justification_urgence: "Estimation automatique (mode démonstration).",
    resume: input.text === null
      ? "Mode démonstration : la lecture des photos et des scans nécessite le service d'IA réel."
      : `Mode démonstration (analyse simplifiée). Extrait : « ${excerpt}${text.length > 280 ? "…" : ""} »`,
    informations_importantes: [],
    confiance: input.text === null ? "faible" : "moyenne",
    contenu_suspect: false,
  };
}

export class MockProvider implements AiProvider {
  readonly name = "mock";
  readonly model = "mock";
  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    const raw = mockAnalyze(input);
    return { raw, model: this.model, inputTokens: Math.ceil((input.text?.length ?? 1000) / 3.5), outputTokens: 600 };
  }
}
