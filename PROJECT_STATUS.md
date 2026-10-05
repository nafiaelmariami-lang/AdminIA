# AdminIA — État du projet

> Dernière mise à jour : 5 octobre 2026 — version 0.1.0 (MVP fonctionnel, **non publié**)

## 1. Objectif

SaaS d'assistance administrative par IA pour indépendants, artisans, micro-entrepreneurs et TPE françaises.

**Positionnement retenu** (voir `docs/01-ETUDE-MARCHE.md`) : *« Photographiez vos courriers. AdminIA vous dit ce que c'est, ce que vous devez faire, et vous rappelle avant l'échéance. »* Le produit est le décodeur de **documents entrants**, avec un échéancier. Il est complémentaire des outils de facturation et de comptabilité (Indy, Abby, Pennylane…), pas concurrent.

Cible prioritaire : micro-entrepreneurs et artisans peu à l'aise avec l'administratif.

## 2. Architecture

Monolithe Next.js (TypeScript) : pages React côté serveur pour la lecture, routes `/api/*` pour l'écriture. La logique métier est isolée dans `src/server/*`, testable sans HTTP. Détails et justification de chaque choix : `docs/02-ARCHITECTURE.md`.

```
src/app/(site)       pages publiques : accueil, tarifs, pages légales
src/app/(auth)       connexion, inscription
src/app/app          espace connecté : tableau de bord, documents, échéances, historique, compte
src/app/api          API : auth, documents, analyse, tâches, agenda, compte, export, santé
src/server           logique métier (auth, documents, ai, billing, tasks, account, storage, db)
src/components       interface (primitives UI, composants de l'espace connecté, site)
drizzle/             migrations SQL versionnées
tests/               tests Vitest (intégration sur vrai moteur Postgres via PGlite)
e2e/                 tests navigateur Playwright
scripts/             migration, purge de conservation, interrupteurs
```

## 3. Technologies

| Domaine | Choix |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Interface | Tailwind CSS 4, composants maison, responsive (barre latérale sur ordinateur, onglets en bas sur mobile) |
| Base de données | PostgreSQL (Drizzle ORM) ; PGlite pour les tests et le développement |
| Authentification | Sessions serveur (jeton de 256 bits haché SHA-256), Argon2id, cookie `__Host-` httpOnly, Secure, SameSite=Lax |
| Stockage | Disque local chiffré AES-256-GCM (interface prête pour un stockage S3 en UE) |
| IA | API Claude (SDK officiel `@anthropic-ai/sdk`), sorties JSON structurées, modèle configurable |
| Extraction | `unpdf` (PDF), `mammoth` (DOCX), vision IA pour les scans et les photos |
| Tests | Vitest (84 tests), Playwright (4 tests de bout en bout : ordinateur et mobile) |

## 4. Fonctionnalités terminées

- [x] Étude de marché, positionnement, modèle économique
- [x] Inscription, connexion, déconnexion ; sessions révocables et glissantes ; limitation des tentatives
- [x] Tableau de bord orienté action (retards, échéances à 30 jours, actions, analyses restantes, points d'attention)
- [x] Ajout de documents : PDF, DOCX, JPEG, PNG, WEBP, TXT ; glisser-déposer ; photo depuis le téléphone ; plusieurs fichiers
- [x] Validation stricte : type réel par octets magiques, taille et pages selon la formule, anti zip-bomb, PDF protégé ou corrompu, HEIC refusé avec un message clair, doublons détectés (pas de nouvelle analyse facturée)
- [x] Analyse IA structurée : type, catégorie, organisme, dates, montants, montant à payer, références, personnes, résumé simple, actions, échéances, urgence, points importants, niveau de confiance
- [x] Réponse aux 5 questions : *Qu'est-ce que c'est ? Qui ? Que faire ? Pour quand ? Combien ?*
- [x] Classement automatique (10 catégories), corrigeable par l'utilisateur
- [x] Échéances et actions générées automatiquement, cochables, modifiables, ajout manuel, export agenda `.ics` (rappels J-7 et J-1)
- [x] Recherche plein texte en français (titre, organisme, résumé, référence, texte intégral) et filtres par catégorie, pagination
- [x] Historique d'activité (sans contenu des documents)
- [x] Consultation et téléchargement de l'original (servi en bac à sable CSP)
- [x] RGPD : export ZIP complet (données JSON et fichiers originaux), suppression de document, suppression définitive du compte
- [x] Protection anti prompt injection (voir §6)
- [x] Protection des coûts IA (voir §6)
- [x] Pages Confidentialité, CGU et Mentions légales (**brouillons signalés comme tels**)
- [x] En-têtes de sécurité (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy)
- [x] Scripts d'exploitation : migrations, purge de conservation (simulation par défaut), interrupteurs de fonctionnalités

## 5. En cours / restant

| Priorité | Fonctionnalité | Remarque |
|---|---|---|
| P1 | Paiement Stripe (Checkout + webhook signé) | **Nécessite votre autorisation.** Champs `plan`, `billing_customer_id` et `plan_renews_at` déjà prévus |
| P1 | Vérification d'e-mail et mot de passe oublié | Nécessite un fournisseur d'e-mails (achat) |
| P1 | Rappels d'échéances par e-mail (J-7, J-1) | Même fournisseur ; l'export `.ics` couvre le besoin en attendant |
| P1 | Stockage objet en UE (S3 compatible) | Implémenter `StorageDriver` ; le disque local suffit sur une seule instance |
| P2 | Double authentification (TOTP) | |
| P2 | File de traitement asynchrone (pg-boss) | Si les analyses longues posent problème chez l'hébergeur |
| P2 | Brouillon de réponse au courrier | Forte valeur, mais à cadrer juridiquement |
| P3 | Partage avec l'expert-comptable, multi-utilisateurs, transfert par e-mail | Deuxième vague (TPE) |

## 6. Décisions importantes

**Sécurité IA (prompt injection)**
- Le prompt système est fixe et ne contient ni secret ni donnée d'un autre utilisateur.
- Le document est encadré par des balises à identifiant aléatoire ; les balises imitées dans le document ou le nom de fichier sont neutralisées.
- Le modèle n'a **aucun outil** et sa sortie est contrainte par un schéma JSON, puis revalidée (Zod) et bornée (dates, montants, longueurs, caractères de contrôle et bidirectionnels).
- Un détecteur heuristique FR/EN et le modèle signalent les contenus suspects, et l'interface affiche une alerte anti-fraude.
- Chaque analyse ne porte que sur **un** document de l'utilisateur authentifié.

**Protection des coûts (tout est contrôlé côté serveur)**
- Quotas mensuels par formule, réservés atomiquement (`INSERT … ON CONFLICT … WHERE … RETURNING`), rendus en cas d'échec du service.
- Limites horaires (ajouts, analyses, connexions, inscriptions, exports).
- Taille, pages et volume de texte bornés ; un PDF scanné est limité à 20 pages.
- Estimation du coût maximal **avant** l'appel : plafond par document, budget quotidien par utilisateur, budget quotidien global (coupe-circuit).
- `max_tokens` borné, effort « bas », 2 tentatives maximum par appel, délai de 120 s, 5 analyses maximum par document, une seule analyse simultanée par compte (verrou consultatif PostgreSQL).
- Journal `ai_calls` : jetons, coût, durée, statut, **sans contenu**.
- Coupe-circuits : `AI_ENABLED=false` (variable d'environnement) ou `npm run settings -- ai_analysis_enabled false` (sans redéploiement).

**Modèle IA** : `claude-opus-5-5` par défaut (4 $ / 20 $ par million de jetons, soit environ 0,02 à 0,05 $ par courrier), avec effort bas et repli automatique côté serveur en cas de refus. Le modèle se change via `AI_MODEL`. Un modèle moins cher (Sonnet 5.5, Haiku 4.5) est une décision business, à valider sur un jeu de documents réels.

**Isolation** : chaque requête filtre par l'`user_id` de la session serveur ; un document étranger renvoie 404 (jamais 403). Les fichiers sont chiffrés avec le chemin comme donnée authentifiée.

**Modèle économique** : Découverte gratuite (5 analyses/mois), Essentiel 7,90 € HT (40), Pro 14,90 € HT (150). Pas d'offre illimitée.

## 7. Lancer le projet

### Développement (le plus simple)

```bash
npm install
npm run dev                       # base PGlite locale (.data/), IA en mode démonstration
```

### Avec PostgreSQL et l'IA réelle

```bash
cp .env.example .env.local        # puis compléter les valeurs
npm run db:migrate
npm run dev
```

### Production

```bash
npm ci
npm run db:migrate                # avec DATABASE_URL de production
npm run build
npm start                         # NODE_ENV=production
# Tâche planifiée quotidienne recommandée :
npm run purge -- --apply
```

## 8. Tester

```bash
npm test                          # 84 tests Vitest
npm run typecheck                 # TypeScript strict
npm run lint                      # ESLint (règles Next.js)
# Bout en bout (serveur lancé sur le port 3000) :
CHROMIUM_PATH=/chemin/vers/chrome npm run test:e2e
```

Couverture fonctionnelle des tests : authentification, sessions, CSRF, force brute, isolation des utilisateurs (lecture, modification, suppression, analyse, fichier, échéances, export), ajout de documents (types, faux types, fichiers vides, corrompus, HEIC, zip-bomb, gros documents, trop de pages, doublons, quotas, fréquence, interrupteur), recherche, modification, suppression, analyse (nominale, vision, normalisation, nouvelle analyse, erreurs, refus, bug), coûts (quota, plafond, budgets, coupe-circuits, fréquence, tentatives), concurrence (même document, plusieurs documents, verrou périmé, suppression pendant une analyse), prompt injection (détection, encadrement, requête réelle envoyée à l'API vérifiée), échéances et `.ics`, export RGPD, suppression de compte, chiffrement (altération, mauvaise clé, déplacement de fichier, traversée de répertoire), purge de conservation.

## 9. Variables d'environnement

Voir `.env.example` (aucune vraie valeur n'y figure).

| Variable | Obligatoire | Rôle |
|---|---|---|
| `APP_URL` | prod | URL publique (contrôle d'origine CSRF) |
| `DATABASE_URL` | prod | PostgreSQL (`pglite://…` uniquement hors production) |
| `STORAGE_DIR` | non | Dossier privé des fichiers chiffrés (défaut `./.data/files`) |
| `STORAGE_ENCRYPTION_KEY` | **prod** | 32 octets en base64. **À sauvegarder** : sans elle, les fichiers sont illisibles |
| `AI_PROVIDER` | non | `anthropic` (réel) ou `mock` (démonstration, défaut) |
| `ANTHROPIC_API_KEY` | si `anthropic` | Clé API, côté serveur uniquement |
| `AI_MODEL` | non | Défaut `claude-opus-5-5` |
| `AI_ENABLED` | non | Coupe-circuit global de l'IA |
| `AI_MAX_COST_PER_DOC_USD` | non | Défaut 0,50 |
| `AI_USER_DAILY_BUDGET_USD` | non | Défaut 2 |
| `AI_DAILY_BUDGET_USD` | non | Défaut 50 (toute la plateforme) |
| `TRUST_PROXY` | non | `true` derrière un reverse proxy de confiance (limites par IP) |

## 10. Problèmes connus et limites

- **Mode démonstration** : sans clé API, l'analyse est heuristique (regex) et ne lit pas les photos ni les scans. L'interface l'indique clairement.
- **L'analyse IA réelle n'a pas été exécutée** pendant le développement (aucune clé API fournie). Le format exact des requêtes est vérifié par les tests ; un test sur 20 à 30 vrais courriers est nécessaire avant le lancement pour mesurer la qualité et le coût réel.
- La CSP autorise `'unsafe-inline'` pour les scripts (scripts d'hydratation de Next.js). Amélioration possible : CSP à nonce via le proxy Next.
- Analyse **synchrone** (jusqu'à environ 2 minutes) : l'hébergeur doit autoriser des requêtes longues (`maxDuration = 150`).
- Le stockage local suppose une seule instance applicative, ou un volume partagé.
- L'extraction PDF tourne dans le processus Node : un délai maximal de 20 s s'applique, mais un PDF malveillant peut consommer du CPU pendant ce temps. Isolation dans un worker à prévoir.
- Pas encore de vérification d'e-mail : une adresse non vérifiée peut créer un compte (limité par fréquence).
- `npm audit` signale des vulnérabilités **uniquement dans l'outillage de développement** (drizzle-kit, eslint-config-next) ; les dépendances de production n'en ont aucune.
- Les textes juridiques sont des **brouillons** à faire valider.

## 11. Prochaines étapes

1. Obtenir une clé API Anthropic et tester sur un corpus de vrais courriers (qualité et coût par document) ; ajuster le prompt et choisir le modèle.
2. Valider juridiquement les CGU, la politique de confidentialité et les mentions légales ; réaliser l'AIPD (données financières, voire de santé).
3. Choisir un hébergeur en UE (application, PostgreSQL managé, stockage objet) et configurer les sauvegardes, y compris la **clé de chiffrement**.
4. Intégrer Stripe (après autorisation) et un fournisseur d'e-mails (vérification, mot de passe oublié, rappels).
5. Bêta privée avec 20 à 50 indépendants ; mesurer l'activation, la rétention et le taux de correction des extractions.
