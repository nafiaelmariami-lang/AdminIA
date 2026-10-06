# AdminIA — consignes de développement

Lire d'abord `PROJECT_STATUS.md` : état réel, limites du moteur IA, et §10 « Reprendre le projet ».

## Règles impératives
- Travailler uniquement dans ce dépôt. Ne jamais toucher au dépôt `histoireia`.
- Branche : `claude/clever-lovelace-ewb694`. Pas de pull request sans demande explicite.
- Sans accord explicite du propriétaire : ne rien publier ni déployer, ne créer aucun compte, ne rien acheter, n'appeler aucune API payante (IA réelle comprise), ne configurer ni Stripe ni e-mail réel, ne toucher ni à Supabase, ni à la production, ni aux données réelles.
- Aucun secret dans Git. Ne jamais affaiblir une protection de sécurité pour faire passer un test.
- Décision importante, compte externe ou dépense : s'arrêter et demander.

## Vérifications avant et après chaque modification
```bash
npm run typecheck && npm run lint && npm test
E2E_DATABASE_URL=postgres://…@127.0.0.1:5432/<base jetable> CHROMIUM_PATH=/opt/pw-browsers/chromium scripts/e2e-local.sh
```
Le script navigateur refuse toute base non locale.

## Conventions
- Interface et messages en français. Logique métier dans `src/server/*`, routes `/api/*` minces enveloppées par `route()` (CSRF, erreurs).
- Toute requête métier filtre par l'utilisateur de la session ; une ressource d'un autre compte renvoie 404.
- Jamais de contenu de document dans les journaux ni dans l'administration.
- Migrations : modifier `src/server/db/schema.ts` puis `npx drizzle-kit generate --name <nom>`.
- Commits en français, descriptifs.
