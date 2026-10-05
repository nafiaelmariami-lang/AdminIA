import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "../evals/cases";
import { scoreAnalysis } from "@/server/ai/eval";
import { normalizeAnalysis } from "@/server/ai/schema";
import { mockAnalyze } from "@/server/ai/mock";
import { sampleRaw } from "./ai-helpers";

describe("harnais d'évaluation IA", () => {
  it("note correctement une analyse conforme et une analyse erronée", () => {
    const good = normalizeAnalysis(sampleRaw());
    const expected = { categorie: "urssaf", montant_a_payer: 1234.56, echeance: "2026-11-15", urgence_min: "eleve" as const };
    expect(scoreAnalysis(expected, good)).toMatchObject({ passed: 4, total: 4 });
    const bad = normalizeAnalysis(sampleRaw({ categorie: "banque", montant_a_payer: 12, echeances: [], actions_requises: [], niveau_urgence: "faible" }));
    expect(scoreAnalysis(expected, bad)).toMatchObject({ passed: 0, total: 4 });
  });

  it("le corpus est cohérent (identifiants uniques, attentes non vides, dates valides)", () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const c of EVAL_CASES) {
      expect(Object.keys(c.expected).length).toBeGreaterThan(0);
      if (c.expected.echeance) expect(c.expected.echeance).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("le moteur de démonstration atteint au moins 80 % sur le corpus (non-régression)", () => {
    let passed = 0;
    let total = 0;
    for (const c of EVAL_CASES) {
      const s = scoreAnalysis(c.expected, normalizeAnalysis(mockAnalyze({ fileName: c.id, today: "2026-10-05", text: c.text })));
      passed += s.passed;
      total += s.total;
    }
    expect(passed / total).toBeGreaterThanOrEqual(0.8);
  });
});
