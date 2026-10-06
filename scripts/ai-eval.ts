/**
 * Évaluation de la qualité et du coût de l'analyse IA sur le corpus evals/cases.ts.
 *
 *   npm run ai:eval                        → fournisseur configuré (mock par défaut), sans coût
 *   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run ai:eval -- --confirm
 *                                          → appels réels (coût affiché AVANT, plafonné à 2 $)
 *   … -- --confirm --serie base            → seulement la série « base » (ou « elargie »)
 *   … -- --confirm --max-cost 5            → relève le plafond (choix explicite, 10 $ au plus)
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

const DEFAULT_MAX_EVAL_COST_USD = 2;
const HARD_MAX_EVAL_COST_USD = 10;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cfg = getConfig();
  const provider = getAiProvider();
  const serie = argValue("--serie");
  if (serie && serie !== "base" && serie !== "elargie") throw new Error("--serie doit valoir « base » ou « elargie ».");
  const maxCostArg = argValue("--max-cost");
  const MAX_EVAL_COST_USD = maxCostArg === undefined ? DEFAULT_MAX_EVAL_COST_USD : Number(maxCostArg);
  if (!Number.isFinite(MAX_EVAL_COST_USD) || MAX_EVAL_COST_USD <= 0 || MAX_EVAL_COST_USD > HARD_MAX_EVAL_COST_USD) {
    throw new Error(`--max-cost doit être compris entre 0 et ${HARD_MAX_EVAL_COST_USD} $.`);
  }
  const CASES = serie ? EVAL_CASES.filter((c) => (c.serie ?? "base") === serie) : EVAL_CASES;
  const maxCost = CASES.reduce((sum, c) => sum + estimateMaxCostUsd(provider.model, estimateInputTokens({ textChars: c.text.length, mode: "text", kind: "other", pages: 1 })), 0);
  console.log(`Fournisseur : ${provider.name} — modèle : ${provider.model} — ${CASES.length} cas${serie ? ` (série ${serie})` : ""}`);
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
  for (const c of CASES) {
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
      console.log(`${score.passed === score.total ? "OK  " : "ÉCART"} ${c.id.padEnd(28)} ${score.passed}/${score.total}  ${cost.toFixed(4)} $  ${Date.now() - started} ms${failed.length ? `  ✗ ${failed.join(", ")}` : ""}`);
    } catch (err) {
      const code = err instanceof AiError ? err.code : "erreur";
      console.log(`ERREUR ${c.id.padEnd(28)} ${code}`);
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
