// Environnement de test : aucune clé réelle, IA simulée, base en mémoire.
process.env.APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = "pglite:memory";
process.env.AI_PROVIDER = "mock";
process.env.ANTHROPIC_API_KEY = "";
process.env.AI_ENABLED = "true";
process.env.TRUST_PROXY = "false";
