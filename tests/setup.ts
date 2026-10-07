// Environnement de test : aucune clé réelle, IA simulée, base en mémoire.
process.env.APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = "pglite:memory";
process.env.AI_PROVIDER = "mock";
process.env.ANTHROPIC_API_KEY = "";
process.env.AI_ENABLED = "true";
process.env.TRUST_PROXY = "false";

// Verrou : aucun test ne doit joindre un vrai serveur Anthropic (appels payants).
// Les tests du client Anthropic passent leur propre `fetch` simulé au SDK.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/^https?:\/\/([^/]*\.)?anthropic\.com(\/|$)/i.test(url)) {
    throw new Error(`Appel réel à Anthropic interdit dans les tests : ${url}`);
  }
  return realFetch(input, init);
}) as typeof fetch;
