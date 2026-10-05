/**
 * Évaluation de la qualité et du coût de l'analyse IA sur le corpus evals/cases.ts.
 *
 *   npm run ai:eval                        → fournisseur configuré (mock par défaut), sans coût
 *   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run ai:eval -- --confirm
 *                                          → appels réels (coût affiché AVANT, plafonné)
 *
 * N'utilise ni la base de données ni le stockage : aucune donnée utilisateur n'est concernée.
 */
import { EVAL_CASES } from "../evals/cases";
import { getConfig } from "@/server/config";
import { getAiProvider } from "@/server/ai/provider";
import { costUsd, estimateInputTokens, estimateMaxCostUsd } from "@/server/ai/cost";
import { detectInjection } from "@/server/ai/injection";
import { normalizeAnalysis } from "@/server/ai/schema";
import { scoreAnalysis } from "@/server/ai/eval";
import { AiError } from "@/server/ai/types";

const MAX_EVAL_COST_USD = 2;

async function main() {
  const cfg = getConfig();
  const provider = getAiProvider();
  const maxCost = EVAL_CASES.reduce((sum, c) => sum + estimateMaxCostUsd(provider.model, estimateInputTokens({ textChars: c.text.length, mode: "text", kind: "other", pages: 1 })), 0);
  console.log(`Fournisseur : ${provider.name} — modèle : ${provider.model} — ${EVAL_CASES.length} cas`);
  console.log(`Coût maximal estimé : ${maxCost.toFixed(3)} $ (plafond du script : ${MAX_EVAL_COST_USD} $)`);
  if (provider.name !== "mock") {
    if (!process.argv.includes("--confirm")) {
      console.log("Appels réels non lancés. Relancez avec --confirm pour accepter ce coût.");
      process.exit(0);
    }
    if (maxCost > MAX_EVAL_COST_USD) throw new Error("Coût estimé supérieur au plafond du script.");
    if (!cfg.AI_ENABLED) throw new Error("AI_ENABLED=false : évaluation impossible.");
  }

  let passed = 0;
  let total = 0;
  let spent = 0;
  for (const c of EVAL_CASES) {
    const started = Date.now();
    try {
      const out = await provider.analyze({ fileName: `${c.id}.txt`, today: "2026-10-05", text: c.text });
      const analysis = normalizeAnalysis(out.raw, detectInjection(c.text));
      const score = scoreAnalysis(c.expected, analysis);
      const cost = costUsd(out.model, out.inputTokens, out.outputTokens);
      spent += cost;
      passed += score.passed;
      total += score.total;
      const failed = Object.entries(score.checks).filter(([, ok]) => !ok).map(([k]) => k);
      console.log(`${score.passed === score.total ? "OK  " : "ÉCART"} ${c.id.padEnd(24)} ${score.passed}/${score.total}  ${cost.toFixed(4)} $  ${Date.now() - started} ms${failed.length ? `  ✗ ${failed.join(", ")}` : ""}`);
    } catch (err) {
      const code = err instanceof AiError ? err.code : "erreur";
      console.log(`ERREUR ${c.id.padEnd(24)} ${code}`);
      total += Object.keys(c.expected).length;
    }
  }
  console.log(`\nScore global : ${passed}/${total} (${total ? Math.round((passed / total) * 100) : 0} %) — coût réel : ${spent.toFixed(4)} $`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
