# AdminIA — Mise en service (actions manuelles)

Tout ce qui peut être fait sans compte externe est prêt et testé. Ce guide liste **uniquement** ce qui exige une action humaine : création de comptes, saisie de clés, réglages chez les prestataires.

> Rien de ce qui suit n'a été fait : aucun compte n'a été créé, aucune clé saisie, aucun paiement effectué, rien n'a été publié.

## 0. Ordre recommandé

1. Hébergement + PostgreSQL + clé de chiffrement → `npm run doctor`
2. Stockage S3 (si plusieurs instances)
3. E-mails (Brevo)
4. IA (Anthropic) → `npm run ai:eval`
5. Tâches planifiées
6. Bêta privée **sans paiement**
7. Stripe en mode test, puis en production

## 1. Hébergement

- Choisir un hébergeur **en UE** compatible Node.js 22 (ex. Scalingo, Clever Cloud, Scaleway) avec **PostgreSQL managé** (sauvegardes automatiques, chiffrement du disque).
- L'hébergeur doit accepter des requêtes HTTP d'au moins **150 s** (route d'analyse).
- Variables minimales : `NODE_ENV=production`, `APP_URL=https://…`, `DATABASE_URL`, `STORAGE_ENCRYPTION_KEY`.
- Générer la clé de chiffrement :
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  **La sauvegarder dans un coffre-fort de mots de passe, hors de l'hébergeur.** Sans elle, aucun document ne peut être relu, y compris depuis une sauvegarde.
- Déploiement : `npm ci && npm run db:migrate && npm run build && npm start`, puis `npm run doctor`, qui doit tout afficher en ✔.
- Derrière un reverse proxy de confiance : `TRUST_PROXY=true` (limites de fréquence par IP).

### Option : image Docker (tout hébergeur acceptant les conteneurs)

Un `Dockerfile` est fourni (Node 22, utilisateur non-root, sonde de santé, aucun secret dans l'image). Testé localement : migrations, tous les parcours navigateur et `npm run doctor` dans le conteneur.

```bash
docker build -t adminia .
docker run --rm --env-file .env.production adminia npm run db:migrate   # avant chaque mise en production
docker run -d --env-file .env.production -p 3000:3000 adminia
docker exec <conteneur> npm run doctor
```

Les tâches planifiées se lancent de la même façon (`docker run --rm --env-file … adminia npm run reminders -- --apply`). Avec `STORAGE_DRIVER=local`, monter un volume persistant sur `/app/.data` ; avec plusieurs instances, utiliser S3.

## 2. Stockage objet S3 (obligatoire dès 2 instances)

- Créer un bucket **privé** en UE (ex. Scaleway Object Storage, région `fr-par`).
- Créer une clé d'accès limitée à ce bucket (lecture, écriture, suppression, listage).
- Variables : `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, éventuellement `S3_PREFIX=production/`.
- Les fichiers sont chiffrés par l'application **avant** l'envoi : le prestataire ne peut pas les lire.
- `npm run doctor` effectue un aller-retour de test (écriture, lecture, suppression).

## 3. E-mails (Brevo, prestataire français)

- Créer un compte Brevo et **authentifier le domaine** d'envoi (enregistrements DNS SPF, DKIM et DMARC), sinon les e-mails finissent en indésirables.
- Créer une clé API « transactionnel ».
- Variables : `EMAIL_DRIVER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM=ne-pas-repondre@votre-domaine.fr`, `EMAIL_FROM_NAME=AdminIA`.
- Tester : inscription → réception du lien de confirmation → mot de passe oublié.

## 4. IA (Anthropic)

- Créer une clé API sur la console Anthropic et **fixer une limite de dépense mensuelle** côté console : c'est une protection supplémentaire, indépendante de celles de l'application.
- Vérifier les conditions de conservation et de confidentialité applicables (DPA), voir `docs/04-RGPD.md`.
- Variables : `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL` (défaut `claude-opus-5-5`).
- Avant tout appel payant : ajouter d'abord la clé seule (en gardant `AI_PROVIDER=mock`) puis `npm run doctor` : la ligne « Clé Anthropic » vérifie gratuitement la clé et l'accès au modèle (lecture de la fiche du modèle, aucun jeton).
- Mesurer la qualité et le coût **avant** d'ouvrir aux utilisateurs. Le corpus compte 22 courriers fictifs (série « base » : 8, série « elargie » : 14, dont 2 tentatives d'injection). Le coût **maximal** est affiché avant tout appel (le coût réel est généralement 5 à 10 fois inférieur) et plafonné à 2 $ par lancement :
  `AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run ai:eval -- --confirm --serie base`
  puis `… -- --confirm --serie elargie`. Pour tout lancer d'un coup, relevez explicitement le plafond : `--max-cost 5` (10 $ au plus).
- Ajouter ensuite des vrais courriers **anonymisés** dans `evals/cases.ts` et relancer. Décider du modèle (Opus 5.5, Sonnet 5.5 ou Haiku 4.5) selon le score et le coût par document.
- Ajuster les budgets si besoin : `AI_MAX_COST_PER_DOC_USD`, `AI_USER_DAILY_BUDGET_USD`, `AI_DAILY_BUDGET_USD`.
- Coupe-circuit immédiat : `npm run settings -- ai_analysis_enabled false`.

## 5. Tâches planifiées

| Tâche | Fréquence | Commande | Alternative HTTP |
|---|---|---|---|
| Rappels d'échéances | Tous les jours à 8 h (Europe/Paris) | `npm run reminders -- --apply` | `POST /api/cron/reminders` avec `Authorization: Bearer $CRON_SECRET` |
| Purge de conservation | Tous les jours à 3 h | `npm run purge -- --apply` | — |

Lancer d'abord chaque commande **sans** `--apply` pour voir la simulation. Les deux tâches sont idempotentes : les relancer ne provoque ni doublon ni double envoi.

## 6. Paiement (Stripe) — après la bêta gratuite

1. Créer le compte Stripe (société, IBAN de versement). C'est la seule étape qui touche à un compte bancaire, **à faire par vous**.
2. En **mode test** d'abord : créer 2 produits (Essentiel, Pro) et 4 prix récurrents en EUR HT : 7,90 €/mois, 79 €/an, 14,90 €/mois, 149 €/an.
3. Webhook : point de terminaison `https://votre-domaine/api/stripe/webhook`, avec les événements `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` et `invoice.payment_failed`.
4. Portail client : autoriser le changement de formule entre ces prix, la mise à jour du moyen de paiement, l'historique des factures et la résiliation **en fin de période**.
5. TVA : configurer Stripe Tax (ou les taux manuellement) puis `STRIPE_AUTOMATIC_TAX=true`. Faire valider la facturation par l'expert-comptable.
6. Variables : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`.
7. Tester avec les cartes de test Stripe : souscription, changement de formule, échec de paiement, résiliation, suppression de compte (qui doit résilier l'abonnement).
8. Passer en mode live avec les clés live.

## 6 bis. Administration

- Renseigner `ADMIN_EMAILS=vous@votre-domaine.fr` (plusieurs adresses séparées par des virgules), puis redémarrer.
- Créer le compte avec cette adresse, confirmer l'e-mail, **activer la double authentification** dans « Mon compte » : sans elle, l'administration reste fermée.
- L'entrée « Administration » apparaît alors dans le menu (`/app/admin`) : statistiques, budget IA du jour, interrupteurs, formules des testeurs, journal des actions.

## 6 ter. Bêta sans e-mail (`EMAIL_DRIVER=disabled`)

En attendant Brevo, l'application reste utilisable par des testeurs invités :
- aucun e-mail ne part ; les écrans le disent (aucun faux « lien envoyé ») ;
- l'analyse exige toujours une adresse confirmée : **l'administrateur confirme chaque testeur** dans `/app/admin` (bouton « Confirmer l'adresse »), uniquement pour des personnes connues ;
- un mot de passe oublié ne peut pas être récupéré (l'administrateur ne peut pas réinitialiser un mot de passe, par choix de confidentialité) ;
- les rappels d'échéances ne partent pas et ne sont pas marqués envoyés : ils partiront après activation de Brevo.

**Premier administrateur** (il ne peut pas confirmer sa propre adresse sans e-mail) : créer d'abord son compte dans l'application avec l'adresse listée dans `ADMIN_EMAILS`, puis sur le serveur :
```bash
npm run account:verify-email -- vous@exemple.fr            # vérifier le compte et sa date de création
npm run account:verify-email -- vous@exemple.fr --apply    # confirmer
```
Ne confirmez qu'un compte que vous avez créé vous-même. Activez ensuite la double authentification dans « Mon compte » : l'administration s'ouvre.

## 7. Sauvegardes et supervision

- Sauvegardes PostgreSQL quotidiennes chiffrées, rétention 30 jours, **test de restauration** avant la bêta.
- Sauvegarde du bucket : versionnage ou réplication (les fichiers sont chiffrés, conserver la clé à part).
- Les journaux sont des lignes JSON (stdout/stderr). Alertes recommandées sur :
  - `ai.analysis_failed` avec `code=config_error` (clé invalide) ;
  - `ai.global_budget_reached` ;
  - `billing.*` (erreurs Stripe, prix inconnu) ;
  - `email.send_failed` ;
  - `retention.account_delete_failed` ;
  - `api.unexpected_error`.
- Sonde de disponibilité : `GET /api/health`.

## 8. Juridique (avant l'ouverture au public)

Voir `docs/04-RGPD.md` : textes juridiques à valider, AIPD, contrats de sous-traitance (DPA), mentions légales complètes, vérification de la marque « AdminIA » à l'INPI.
