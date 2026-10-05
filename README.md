# AdminIA

**AdminIA lit les courriers administratifs des indépendants (Urssaf, impôts, assurances, factures…), explique ce qu'ils disent, ce qu'il faut faire et pour quand, puis suit les échéances.**

- Étude de marché et décisions produit : [`docs/01-ETUDE-MARCHE.md`](docs/01-ETUDE-MARCHE.md)
- Architecture : [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md)
- État du projet, commandes, variables, prochaines étapes : [`PROJECT_STATUS.md`](PROJECT_STATUS.md)

## Démarrage rapide (développement, sans PostgreSQL ni clé API)

```bash
npm install
DATABASE_URL=pglite://./.data/pglite npm run dev
# → http://localhost:3000
```

Avec cette configuration, la base est un PostgreSQL embarqué (PGlite), migré automatiquement. L'IA fonctionne en **mode démonstration**, sans appel externe ni coût.

## Tests

```bash
npm test              # tests unitaires et d'intégration (Vitest, base PGlite en mémoire)
npm run typecheck
npm run lint
npm run test:e2e      # parcours navigateur (Playwright), serveur lancé au préalable
```
