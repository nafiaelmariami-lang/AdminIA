import type { RawAnalysis } from "@/server/ai/schema";
import type { AiProvider, AnalysisInput, AnalysisOutput } from "@/server/ai/types";

export function sampleRaw(overrides: Partial<RawAnalysis> = {}): RawAnalysis {
  return {
    titre: "Appel de cotisations Urssaf — 3e trimestre",
    type_document: "appel_cotisations",
    categorie: "urssaf",
    organisme: "Urssaf Île-de-France",
    date_document: "2026-10-02",
    reference: "AB12345678",
    entreprise: null,
    personnes: [],
    montants: [{ libelle: "Cotisations provisionnelles", montant: 1234.56, devise: "EUR", sens: "a_payer" }],
    montant_a_payer: 1234.56,
    dates_importantes: [{ date: "2026-10-02", libelle: "Date du courrier" }],
    echeances: [
      { date: "2026-11-15", libelle: "Date limite de paiement", type: "paiement" },
      { date: "2026-12-02", libelle: "Fin du délai de contestation", type: "contestation" },
    ],
    actions_requises: [{ action: "Payer 1 234,56 € sur urssaf.fr", echeance: "2026-11-15", priorite: "haute" }],
    aucune_action_requise: false,
    niveau_urgence: "eleve",
    justification_urgence: "Paiement requis sous 6 semaines.",
    resume: "L'Urssaf vous demande de payer vos cotisations du 3e trimestre avant le 15 novembre 2026.",
    informations_importantes: ["Des majorations s'appliquent en cas de retard."],
    confiance: "haute",
    contenu_suspect: false,
    ...overrides,
  };
}

/** Fournisseur de test : enregistre les entrées, réponse configurable, coût réaliste. */
export class SpyProvider implements AiProvider {
  readonly name = "spy";
  calls: AnalysisInput[] = [];
  constructor(
    public respond: (input: AnalysisInput) => Promise<RawAnalysis> | RawAnalysis = () => sampleRaw(),
    readonly model = "claude-opus-5-5",
  ) {}
  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    this.calls.push(input);
    const raw = await this.respond(input);
    return { raw, model: this.model, inputTokens: 3000, outputTokens: 1000 };
  }
}

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
