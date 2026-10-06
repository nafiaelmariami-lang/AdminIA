# AdminIA — État du projet

> Dernière mise à jour : 6 octobre 2026 — **version 0.3.0-dev** (bêta privée préparée, **non publiée** ; v0.3 en cours)

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
PostgreSQL (Drizzle, 7 migrations) · stockage chiffré local ou S3 · Claude (Anthropic) · Brevo · Stripe · tâches planifiées.

## 4. Fonctionnalités terminées

**Compte et sécurité**
- [x] Inscription avec preuve de consentement (version des CGU), connexion, déconnexion, sessions révocables
- [x] Confirmation d'adresse e-mail (obligatoire avant l'analyse IA), renvoi du lien
- [x] Mot de passe oublié, réinitialisation (jeton à usage unique, toutes sessions fermées), changement depuis l'espace, notification de sécurité
- [x] Double authentification facultative (application TOTP + 10 codes de secours à usage unique), anti-rejeu, 5 essais par étape de connexion, réinitialisation du mot de passe sans ouverture de session pour ces comptes
- [x] CSP stricte à nonce, en-têtes de sécurité, limitation de fréquence partout, CSRF

**Documents et IA**
- [x] Ajout PDF, DOCX, JPEG, PNG, WEBP, TXT ; photo depuis le téléphone, réduite dans le navigateur
- [x] Validation stricte (octets magiques, dimensions d'image, anti zip-bomb, pages, taille), lecture isolée dans un worker
- [x] Analyse IA structurée répondant à *Quoi ? Qui ? Que faire ? Pour quand ? Combien ?*, classement automatique
- [x] Contrôle de la réponse dans l'ordre : refus, troncature, arrêt inattendu, réponse vide, JSON, schéma Zod
- [x] Anti prompt injection (encadrement, aucun outil, sortie contrainte, détecteur résistant aux évasions)
- [x] Protection des coûts : estimation préalable, plafonds par document, par utilisateur et global, quotas atomiques, coupe-circuits, tentatives bornées
- [x] Journal des appels IA sans contenu (jetons, coût, durée, identifiant de requête, modèle de repli)
- [x] Harnais d'évaluation qualité et coût (`npm run ai:eval`)
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
- [x] Stockage S3 multi-instance, `npm run doctor`, `settings`, `purge`, `reminders`, route cron protégée

## 5. Restant (nécessite un compte externe ou une décision)

| Élément | Bloquant pour | Action |
|---|---|---|
| Clé Anthropic + évaluation sur de vrais courriers | Bêta | `docs/03-DEPLOIEMENT.md` §4 |
| Compte Brevo + DNS du domaine | Bêta | §3 |
| Hébergement UE + PostgreSQL + bucket S3 | Bêta | §1–2 |
| Compte Stripe (produits, webhook, TVA) | Fin de bêta | §6 |
| Validation juridique, AIPD, DPA | Public | `docs/04-RGPD.md` |
| CAPTCHA, interface d'administration, file d'analyse | Après bêta | `docs/05-AUDIT-BETA.md` |

## 6. Commandes

```bash
npm install
npm run dev                       # développement : base PGlite, IA de démonstration, e-mails dans .data/outbox
npm test                          # 242 tests Vitest
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

- **242 tests Vitest** (21 fichiers) sur un vrai moteur PostgreSQL (PGlite) : authentification, comptes et e-mails, isolation, documents, images, lecture isolée, analyse, ordre des contrôles IA, erreurs API, schéma JSON, injection, coûts, concurrence, échéances, rappels, agenda, désabonnement, double authentification (vecteurs RFC 4226/6238, rejeu, codes de secours, concurrence), cron, Stripe, stockage local et S3 (contrat + parcours complet), purge et inactivité, interrupteurs, configuration de production, journaux, corps de requête bornés, secrets.
- **8 tests Playwright** (4 parcours × ordinateur et mobile) sur build de production + PostgreSQL 16 : parcours complet avec confirmation d'e-mail, édition d'échéance, CSP sans violation, absence de débordement mobile, mot de passe oublié, double authentification (activation, code, code de secours, désactivation), pages publiques. **Visite visuelle** de 25 pages × 2 formats (sur demande).

## 8. Variables d'environnement

Voir `.env.example` (commenté, sans valeur secrète) et `docs/03-DEPLOIEMENT.md`. La configuration est validée au démarrage ; en production, l'application refuse de démarrer si une clé de chiffrement, une base, un expéditeur ou une configuration Stripe est incohérente.

## 9. Problèmes connus

Voir `docs/05-AUDIT-BETA.md` §3. Les principaux :
- qualité IA réelle non mesurée ;
- textes juridiques en brouillon ;
- pas de CAPTCHA ;
- analyse synchrone (hébergeur à 150 s) ;
- `braces` (outillage ESLint) et `sprintf-js` (via `mammoth` → `argparse`, partie ligne de commande non utilisée) : avis « modéré » sans correctif publié.

## 10. Prochaines étapes

1. Actions manuelles §1 à §5 de `docs/03-DEPLOIEMENT.md`, puis `npm run doctor` vert.
2. Évaluer l'IA sur 20 à 30 vrais courriers ; choisir le modèle et ajuster les budgets.
3. Bêta privée gratuite (10 à 50 testeurs) : activation, rétention, taux de correction des extractions.
4. Validation juridique ; Stripe en mode test puis live.
5. v0.3 : ~~double authentification~~ (fait), interface d'administration, file d'analyse asynchrone (décision d'hébergement à prendre).
