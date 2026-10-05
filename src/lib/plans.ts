/**
 * Formules commerciales. Ce fichier est partagé (affichage des tarifs) mais les limites
 * ne sont APPLIQUÉES que côté serveur, à partir de la formule enregistrée en base.
 */
export type PlanId = "free" | "essentiel" | "pro";

export type Plan = {
  id: PlanId;
  label: string;
  priceMonthlyEurHt: number;
  priceYearlyEurHt: number;
  analysesPerMonth: number;
  maxDocuments: number;
  maxFileBytes: number;
  maxPages: number;
  analysesPerHour: number;
  uploadsPerHour: number;
  highlights: string[];
};

const MB = 1024 * 1024;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Découverte",
    priceMonthlyEurHt: 0,
    priceYearlyEurHt: 0,
    analysesPerMonth: 5,
    maxDocuments: 50,
    maxFileBytes: 10 * MB,
    maxPages: 20,
    analysesPerHour: 5,
    uploadsPerHour: 20,
    highlights: ["5 analyses IA par mois", "50 documents stockés", "Échéancier et recherche"],
  },
  essentiel: {
    id: "essentiel",
    label: "Essentiel",
    priceMonthlyEurHt: 7.9,
    priceYearlyEurHt: 79,
    analysesPerMonth: 40,
    maxDocuments: 1000,
    maxFileBytes: 15 * MB,
    maxPages: 50,
    analysesPerHour: 15,
    uploadsPerHour: 60,
    highlights: ["40 analyses IA par mois", "1 000 documents stockés", "Export agenda des échéances", "Support par e-mail"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceMonthlyEurHt: 14.9,
    priceYearlyEurHt: 149,
    analysesPerMonth: 150,
    maxDocuments: 5000,
    maxFileBytes: 20 * MB,
    maxPages: 100,
    analysesPerHour: 30,
    uploadsPerHour: 120,
    highlights: ["150 analyses IA par mois", "5 000 documents stockés", "Documents jusqu'à 100 pages", "Support prioritaire"],
  },
};

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : "free"];
}

/** Limites techniques absolues, indépendantes de la formule. */
export const HARD_LIMITS = {
  /** Taille maximale d'une image envoyée à l'IA (limite de l'API). */
  maxImageBytes: 5 * MB,
  /** Pages maximales d'un PDF scanné (lu visuellement, plus coûteux). */
  maxVisionPages: 20,
  /** Caractères de texte maximum envoyés à l'IA (~40 000 jetons). */
  maxTextChars: 150_000,
  /** Taille décompressée maximale d'un DOCX (anti zip-bomb). */
  maxDocxUncompressedBytes: 60 * MB,
  maxDocxEntries: 3000,
} as const;
