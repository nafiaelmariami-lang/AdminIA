# AdminIA — État du projet

> Dernière mise à jour : 6 octobre 2026 — **version 0.3.0** (bêta privée préparée, **non publiée**)

## 1. Objectif

SaaS d'assistance administrative par IA pour indépendants, artisans, micro-entrepreneurs et TPE françaises.
Positionnement (voir `docs/01-ETUDE-MARCHE.md`) : *« Photographiez vos courriers. AdminIA vous dit ce que c'est, ce que vous devez faire, et vous rappelle avant l'échéance. »*

## 2. Documentation

| Document | Contenu |
|---|---|
| `docs/01-ETUDE-MARCHE.md` | Marché, concurrence, décisions produit, modèle économique |
| `docs/02-ARCHITECTURE.md` | Architecture, choix techniques, modèle de données, multi-instance |
| `docs/03-DEPLOIEMENT.md` | **Actions manuelles restantes** : hébergement, S3, e-mails, IA, Stripe, tâches planifiées |
| `docs/04-RGPD.md` | Registre des traitements, sous-traitants, droits, AIPD (brouillon) |
| `docs/05-AUDIT-BETA.md` | Audit avant bêta : problèmes corrigés, points ouverts, verdict |

## 3. Architecture (résumé)

Monolithe Next.js 16 (TypeScript strict). Logique métier dans `src/server/*`, routes `/api/*` minces, pages serveur.
PostgreSQL (Drizzle, 9 migrations) · stockage chiffré local ou S3 · Claude (Anthropic) · Brevo · Stripe · tâches planifiées.

## 4. Fonctionnalités terminées

**Compte et sécurité**
- [x] Inscription avec preuve de consentement (version des CGU), connexion, déconnexion, sessions révocables
- [x] Confirmation d'adresse e-mail (obligatoire avant l'analyse IA), renvoi du lien
- [x] Mot de passe oublié, réinitialisation (jeton à usage unique, toutes sessions fermées), changement depuis l'espace, notification de sécurité
- [x] Changement d'adresse e-mail : mot de passe (+ code 2FA), lien vers la nouvelle adresse, avertissement à l'ancienne, **annulation possible pendant 7 jours depuis l'ancienne adresse** (sessions fermées, 2FA retirée, nouveau mot de passe), synchronisation du client Stripe
- [x] Double authentification facultative (application TOTP + 10 codes de secours à usage unique), anti-rejeu, 5 essais par étape de connexion, réinitialisation du mot de passe sans ouverture de session pour ces comptes
- [x] Anti-robots sans prestataire (champ piège) sur inscription et mot de passe oublié ; verrouillage de connexion par compte + IP derrière un proxy de confiance
- [x] Intégration continue GitHub Actions (pull requests et à la demande, aucun secret)
- [x] CSP stricte à nonce, en-têtes de sécurité, limitation de fréquence partout, CSRF

**Application**
- [x] Installable sur téléphone et ordinateur (manifeste, icônes, raccourcis « Ajouter un courrier » et « Mes échéances »), sans service worker : aucune donnée personnelle mise en cache sur l'appareil

**Documents et IA**
- [x] Ajout PDF, DOCX, JPEG, PNG, WEBP, TXT ; photo depuis le téléphone, réduite dans le navigateur
- [x] Validation stricte (octets magiques, dimensions d'image, anti zip-bomb, pages, taille), lecture isolée dans un worker
- [x] Analyse IA structurée répondant à *Quoi ? Qui ? Que faire ? Pour quand ? Combien ?*, classement automatique
- [x] Contrôle de la réponse dans l'ordre : refus, troncature, arrêt inattendu, réponse vide, JSON, schéma Zod
- [x] Anti prompt injection (encadrement, aucun outil, sortie contrainte, détecteur résistant aux évasions)
- [x] Protection des coûts : estimation préalable, plafonds par document, par utilisateur et global, quotas atomiques, coupe-circuits, tentatives bornées
- [x] Journal des appels IA sans contenu (jetons, coût, durée, identifiant de requête, modèle de repli)
- [x] Harnais d'évaluation qualité et coût (`npm run ai:eval`) : 22 courriers fictifs (Urssaf, impôts, CAF, banque, assurance, fournisseurs, contrats, 2 injections), par série, plafond de coût
- [x] Recherche plein texte française, filtres, pagination, historique

**Échéances**
- [x] Échéances générées par l'IA ou manuelles, modifiables, export `.ics`
- [x] Rappels par e-mail J-7, J-1 et retard (idempotents, multi-instance), désabonnement sans connexion
- [x] Abonnement agenda privé (Google, Outlook, Apple) par lien secret révocable

**Commercial**
- [x] Formules Découverte, Essentiel (7,90 € HT) et Pro (14,90 € HT), quotas appliqués côté serveur
- [x] Stripe prêt : Checkout, portail client, webhooks signés et idempotents, résiliation à la suppression du compte (désactivé sans clé)

**RGPD et exploitation**
- [x] Export ZIP complet, suppression de document ou de compte, purge de conservation, cycle d'inactivité (avertissement puis suppression)
- [x] Pages légales mises à jour (**brouillons**), registre des traitements
- [x] Interface d'administration `/app/admin` (adresses `ADMIN_EMAILS`, double authentification obligatoire) : statistiques agrégées, budget IA du jour, erreurs IA, interrupteurs, formule des testeurs, journal d'audit — **sans accès au contenu des documents**
- [x] Image Docker de production (non-root, sonde de santé), validée par tous les parcours navigateur exécutés contre le conteneur
- [x] Stockage S3 multi-instance, `npm run doctor`, `settings`, `purge`, `reminders`, route cron protégée

## 5. Restant (nécessite un compte externe ou une décision)

| Élément | Bloquant pour | Action |
|---|---|---|
| Clé Anthropic + évaluation sur de vrais courriers | Bêta | `docs/03-DEPLOIEMENT.md` §4 |
| Compte Brevo + DNS du domaine | Bêta | §3 |
| Hébergement UE + PostgreSQL + bucket S3 | Bêta | §1–2 |
| Compte Stripe (produits, webhook, TVA) | Fin de bêta | §6 |
| Validation juridique, AIPD, DPA | Public | `docs/04-RGPD.md` |
| CAPTCHA, file d'analyse asynchrone | Après bêta | `docs/05-AUDIT-BETA.md` |

## 6. Commandes

```bash
npm install
npm run dev                       # développement : base PGlite, IA de démonstration, e-mails dans .data/outbox
npm test                          # 274 tests Vitest
npm run typecheck && npm run lint
npm run build && npm start        # production
npm run db:migrate                # migrations
npm run doctor                    # diagnostic de mise en service (sans coût)
npm run ai:eval                   # évaluation IA (mock ; appels réels avec --confirm)
npm run reminders [-- --apply]    # rappels d'échéances (simulation par défaut)
npm run purge [-- --apply]        # purge de conservation (simulation par défaut)
npm run settings -- ai_analysis_enabled false   # coupe-circuit
# Tests navigateur (serveur lancé sur :3000 avec EMAIL_DRIVER=outbox) :
E2E_OUTBOX_DIR=… CHROMIUM_PATH=… npm run test:e2e
E2E_TOUR=1 … npm run test:e2e -- visite          # captures de toutes les pages
```

## 7. Tests

- **274 tests Vitest** (24 fichiers) sur un vrai moteur PostgreSQL (PGlite) : authentification, comptes et e-mails, isolation, documents, images, lecture isolée, analyse, ordre des contrôles IA, erreurs API, schéma JSON, injection, coûts, concurrence, échéances, rappels, agenda, désabonnement, double authentification (vecteurs RFC 4226/6238, rejeu, codes de secours, concurrence), administration (accès, absence de fuite de contenu, audit), changement d'adresse (énumération, annulation, purge), anti-robots et verrouillage par IP, cron, Stripe, stockage local et S3 (contrat + parcours complet), purge et inactivité, interrupteurs, configuration de production, journaux, corps de requête bornés, secrets.
- **14 tests Playwright** (7 parcours × ordinateur et mobile, exécutés un par un) sur build de production + PostgreSQL 16 : parcours complet avec confirmation d'e-mail, édition d'échéance, CSP sans violation, absence de débordement mobile, mot de passe oublié, double authentification (activation, code, code de secours, désactivation), administration (accès refusé, 2FA exigée, interrupteurs, formule), changement d'adresse (confirmation puis annulation), application installable, pages publiques. Le parcours d'administration exige `ADMIN_EMAILS=e2e-admin-desktop@exemple.fr,e2e-admin-mobile@exemple.fr` côté serveur. **Visite visuelle** de 25 pages × 2 formats (sur demande).

## 8. Variables d'environnement

Voir `.env.example` (commenté, sans valeur secrète) et `docs/03-DEPLOIEMENT.md`. La configuration est validée au démarrage ; en production, l'application refuse de démarrer si une clé de chiffrement, une base, un expéditeur ou une configuration Stripe est incohérente.

## 9. Problèmes connus

Voir `docs/05-AUDIT-BETA.md` §3. Les principaux :
- qualité IA réelle non mesurée ;
- textes juridiques en brouillon ;
- pas de CAPTCHA (champ piège + limites de fréquence ; à renforcer seulement si abus) ;
- analyse synchrone (hébergeur acceptant 150 s) : **choix confirmé pour la bêta** (pas de file, pas de worker, pas de service supplémentaire) ;
- `braces` (outillage ESLint) et `sprintf-js` (via `mammoth` → `argparse`, partie ligne de commande non utilisée) : avis « modéré » sans correctif publié.

## 10. Prochaines étapes

1. Actions manuelles §1 à §5 de `docs/03-DEPLOIEMENT.md`, puis `npm run doctor` vert.
2. Évaluer l'IA sur 20 à 30 vrais courriers ; choisir le modèle et ajuster les budgets.
3. Bêta privée gratuite (10 à 50 testeurs) : activation, rétention, taux de correction des extractions.
4. Validation juridique ; Stripe en mode test puis live.
5. v0.3 terminée : double authentification, administration, changement d'adresse, application installable, anti-robots, CI, image Docker, corpus d'évaluation élargi. File d'analyse asynchrone : **écartée pour la bêta** (décision du 6 octobre 2026), à reconsidérer seulement si le volume l'exige.
6. Reporté (décision produit, risque juridique ou coût) : brouillon de réponse aux courriers, « discuter avec mes documents », partage avec l'expert-comptable, transfert par e-mail.
