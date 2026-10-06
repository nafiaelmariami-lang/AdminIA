# AdminIA

**AdminIA lit les courriers administratifs des indépendants (Urssaf, impôts, assurances, factures…), explique ce qu'ils disent, ce qu'il faut faire et pour quand, puis suit les échéances.**

- Étude de marché et décisions produit : [`docs/01-ETUDE-MARCHE.md`](docs/01-ETUDE-MARCHE.md)
- Architecture : [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md)
- Mise en service (actions manuelles) : [`docs/03-DEPLOIEMENT.md`](docs/03-DEPLOIEMENT.md)
- RGPD : [`docs/04-RGPD.md`](docs/04-RGPD.md) · Audit avant bêta : [`docs/05-AUDIT-BETA.md`](docs/05-AUDIT-BETA.md)
- **État du projet, limites de l'IA, reprise** : [`PROJECT_STATUS.md`](PROJECT_STATUS.md)

## Démarrage rapide (développement, sans PostgreSQL ni clé API)

```bash
npm install
DATABASE_URL=pglite://./.data/pglite npm run dev
# → http://localhost:3000
```

Avec cette configuration, la base est un PostgreSQL embarqué (PGlite), migré automatiquement. L'IA fonctionne en **mode démonstration**, sans appel externe ni coût. Les e-mails (confirmation d'adresse, mot de passe) sont écrits dans `.data/outbox/` : ouvrez le fichier JSON le plus récent pour cliquer sur le lien.

## Tests

```bash
npm test              # tests unitaires et d'intégration (Vitest, base PGlite en mémoire)
npm run typecheck
npm run lint
# Parcours navigateur sur build de production (PostgreSQL LOCAL et jetable uniquement) :
E2E_DATABASE_URL=postgres://adminia:…@127.0.0.1:5432/adminia_e2e scripts/e2e-local.sh
```

Pour reprendre le projet (état réel, limites du moteur IA, comptes externes, règles) : voir **`PROJECT_STATUS.md` §10** et `CLAUDE.md`.
