# AdminIA — État du projet

> Dernière mise à jour : 6 octobre 2026 — **version 0.3.0, validée comme état de développement.**
> **Rien n'est publié.** Aucun compte externe n'a été créé, aucune clé réelle utilisée, aucune dépense engagée, aucune donnée de production ni Supabase touchée.

SaaS d'assistance administrative par IA pour indépendants, artisans, micro-entrepreneurs et TPE françaises : *« Photographiez vos courriers. AdminIA vous dit ce que c'est, ce que vous devez faire, et vous rappelle avant l'échéance. »*

**Sommaire** : 1. Synthèse · 2. Terminé · 3. Testé seulement en local · 4. Moteur d'analyse IA · 5. Comptes externes · 6. Validation juridique · 7. Avant une première bêta · 8. Reporté · 9. Problèmes connus · 10. **Reprendre le projet** · 11. Documentation

---

## 1. Synthèse en une minute

| Question | Réponse |
|---|---|
| Le code des fonctionnalités prévues est-il écrit ? | **Oui**, pour toute la bêta privée (voir §2). |
| Est-il testé ? | **Oui, en local uniquement** : 274 tests automatiques, 14 parcours navigateur sur build de production et PostgreSQL 16, et l'image Docker. |
| A-t-il tourné chez un hébergeur, avec de vrais e-mails, une vraie IA, un vrai paiement ? | **Non.** Rien de cela n'a jamais été exécuté (§3, §5). |
| L'analyse IA est-elle de bonne qualité ? | **Inconnu.** Le vrai modèle n'a **jamais été appelé**. Tout ce que vous avez vu en local vient d'un **moteur de démonstration simplifié** (§4). |
| Peut-on ouvrir à de vrais utilisateurs ? | **Pas encore.** Voir la liste ordonnée au §7. |

---

## 2. Ce qui est réellement terminé (code écrit, relu, couvert par des tests)

**Compte et sécurité**
- Inscription avec preuve du consentement (version des CGU), connexion, déconnexion, sessions révocables.
- Confirmation d'adresse e-mail, **obligatoire avant toute analyse IA**, avec renvoi du lien.
- Mot de passe oublié / réinitialisation (lien à usage unique, toutes les sessions fermées) ; changement depuis l'espace ; e-mails de sécurité.
- **Double authentification** facultative (application TOTP + 10 codes de secours) : anti-rejeu, 5 essais par étape de connexion ; la réinitialisation du mot de passe n'ouvre pas de session pour ces comptes.
- **Changement d'adresse e-mail** : lien vers la nouvelle adresse, avertissement à l'ancienne, **annulation possible pendant 7 jours** depuis l'ancienne adresse.
- Anti-robots sans prestataire (champ piège) ; limites de fréquence partout ; verrouillage de connexion par compte + IP derrière un proxy de confiance ; CSRF ; CSP stricte à nonce ; en-têtes de sécurité.

**Documents**
- Ajout PDF, DOCX, JPEG, PNG, WEBP, TXT ; photo depuis le téléphone, réduite dans le navigateur.
- Validation stricte (type réel par octets magiques, taille, dimensions, pages, anti zip-bomb) ; lecture des PDF/DOCX dans un worker isolé (mémoire plafonnée, arrêt forcé).
- Fichiers **chiffrés par l'application** (AES-256-GCM) avant stockage, sur disque local ou S3.
- Recherche plein texte française, filtres, pagination, historique d'activité.

**Analyse IA (tuyauterie, voir §4 pour la qualité)**
- Appel au modèle, sortie contrainte par schéma, contrôles dans l'ordre (refus, troncature, arrêt inattendu, réponse vide, JSON, schéma), normalisation.
- Anti prompt injection (encadrement aléatoire, aucun outil, sortie contrainte, détecteur robuste aux évasions).
- Protection des coûts : estimation avant appel, plafonds par document / utilisateur / jour, quotas mensuels atomiques, coupe-circuits, tentatives bornées, journal des appels **sans contenu**.
- Harnais d'évaluation `npm run ai:eval` : 22 courriers fictifs, par série, coût maximal affiché et plafonné.

**Échéances**
- Échéances issues de l'analyse ou manuelles, modifiables ; export `.ics` ; abonnement agenda privé révocable.
- Rappels e-mail J-7, J-1 et retard (idempotents, multi-instance), désabonnement sans connexion.

**Commercial**
- Formules Découverte / Essentiel (7,90 € HT) / Pro (14,90 € HT), quotas appliqués côté serveur.
- Stripe **prêt mais désactivé** : Checkout, portail, webhooks signés et idempotents, résiliation à la suppression du compte.

**RGPD et exploitation**
- Export ZIP complet ; suppression d'un document ou du compte ; purge de conservation ; cycle d'inactivité (avertissement puis suppression).
- **Interface d'administration** `/app/admin` (adresses `ADMIN_EMAILS` + 2FA obligatoire) : statistiques agrégées, budget IA, interrupteurs, formule des testeurs, journal d'audit — **aucun accès au contenu des documents**.
- Application installable (manifeste, icônes), sans service worker.
- Scripts `doctor`, `settings`, `purge`, `reminders`, `ai:eval` ; route cron protégée ; image Docker ; intégration continue GitHub Actions.

---

## 3. Ce qui est seulement testé en local (jamais en conditions réelles)

| Élément | Ce qui a été vérifié | Ce qui ne l'a **jamais** été |
|---|---|---|
| Application complète | Build de production + PostgreSQL 16 local + 14 parcours navigateur (ordinateur et mobile), aussi **dans le conteneur Docker** | Un hébergeur réel, un nom de domaine, HTTPS, la charge |
| Base de données | PostgreSQL 16 local et PGlite ; 9 migrations sur base vierge | Une base hébergée (y compris Supabase), les sauvegardes et leur restauration |
| Stockage S3 | Faux serveur S3 en test (contrat complet, pagination, suppression) | Un vrai bucket (Scaleway ou autre) |
| E-mails | Écrits dans un dossier local (`outbox`) ; envoi Brevo testé contre une API simulée | Un seul e-mail réellement envoyé ; la délivrabilité (SPF, DKIM, DMARC) |
| IA | Moteur de démonstration ; client Anthropic testé avec des **réponses simulées** | **Aucun appel réel au modèle** (§4) |
| Paiement | Webhooks Stripe simulés et signés, appels Stripe simulés | Aucune transaction, même en mode test Stripe |
| Tâches planifiées | Scripts et route cron lancés à la main | Une planification réelle chez un hébergeur |
| Intégration continue | Fichier `.github/workflows/ci.yml` poussé | Jamais exécutée (déclenchée seulement sur une pull request ou à la demande) |
| Votre PC (Windows) | Corrections Windows (lecture PDF) testées par simulation | Les nouveautés v0.3 n'ont pas été relancées sur votre PC |

---

## 4. Moteur d'analyse IA : état actuel et limitations

### 4.1 Les deux moteurs

| | **Moteur de démonstration** (`AI_PROVIDER=mock`, par défaut) | **Moteur réel** (`AI_PROVIDER=anthropic`) |
|---|---|---|
| Ce que c'est | Règles locales (expressions régulières) : organisme, dates, montants, mots-clés | Modèle Claude via l'API Anthropic (`AI_MODEL`, défaut `claude-opus-5-5`) |
| Coût | Nul, aucun appel externe | Payant, à la consommation |
| État | **C'est lui qui a produit toutes les analyses vues jusqu'ici.** Bandeau « Mode démonstration » affiché | Code complet et testé **avec des réponses simulées uniquement**. **Jamais appelé pour de vrai** |
| Qualité | Faible et rigide : résumé = extrait du texte, aucune compréhension. Score 91 % sur le corpus fictif, uniquement parce que les courriers fictifs sont « propres » | **Inconnue** tant que l'évaluation n'est pas faite |

### 4.2 Limitations actuelles

1. **Qualité réelle non mesurée.** Aucun chiffre de qualité n'existe pour le vrai modèle. C'est le risque n°1 avant la bêta.
2. **Premier appel réel = première validation technique.** Les paramètres d'appel (sortie structurée, `effort`, repli serveur en bêta) sont conformes à la documentation au moment de l'écriture, mais n'ont jamais été acceptés par la vraie API. Si l'API refuse un paramètre, l'erreur est classée `config_error` ou `provider_error`, le quota est rendu, et il faut corriger `src/server/ai/anthropic.ts`.
3. **Photos et scans** : le démonstrateur ne les lit pas du tout (il affiche « nécessite le service d'IA réel »). Le moteur réel les envoie au modèle en mode visuel. Aucun OCR local. Au plus 15 pages pour un PDF scanné.
4. **Analyse synchrone** : jusqu'à ~2 minutes par requête (2 tentatives × 60 s, plafond global 130 s). L'hébergeur doit accepter 150 s. **Choix confirmé pour la bêta** : pas de file d'attente.
5. **Coûts estimés, pas mesurés** : tarifs codés dans `src/server/ai/cost.ts` (prix de septembre 2026, à revérifier). Un modèle inconnu est compté au tarif le plus élevé, par prudence. Budgets par défaut : 0,50 $/document, 2 $/utilisateur/jour, 50 $/jour au total.
6. **Pas de conseil** : l'analyse aide à comprendre ; elle peut se tromper (montants, dates). Les CGU le disent ; l'interface invite à vérifier sur l'original.
7. **Confidentialité** : le contenu des documents part chez Anthropic (États-Unis) pour l'analyse. Conditions de conservation et DPA à vérifier (§6).
8. **Non développé** (choix produit) : brouillon de réponse au courrier, questions libres sur ses documents, OCR local.

### 4.3 Comment mesurer la qualité (à faire avec votre clé, §5)

1. Créer la clé et **fixer une limite de dépense mensuelle dans la console Anthropic**.
2. `AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run ai:eval` : affiche le coût **maximal** sans rien appeler.
3. `… -- --confirm --serie base` puis `… -- --confirm --serie elargie` : chaque lancement est plafonné à 2 $ (coût réel généralement bien inférieur).
4. Ajouter 20 à 30 **vrais** courriers **anonymisés** dans `evals/cases.ts` et relancer.
5. Choisir le modèle selon score et coût par document ; ajuster les budgets.

---

## 5. Ce qui nécessite vos comptes externes

Guide pas à pas : `docs/03-DEPLOIEMENT.md`. Aucune de ces actions n'a été faite.

| # | Compte | Pour quoi | Bloquant pour |
|---|---|---|---|
| 1 | **Hébergeur en UE** + PostgreSQL managé (Scaleway, Clever Cloud, Scalingo…). Supabase peut servir de PostgreSQL via `DATABASE_URL`, mais n'a jamais été utilisé par ces sessions | Mettre l'application en ligne, requêtes de 150 s acceptées | Bêta |
| 2 | **Stockage objet S3 en UE** | Fichiers chiffrés, plusieurs instances | Bêta (si plus d'une instance) |
| 3 | **Brevo** + DNS du domaine (SPF, DKIM, DMARC) | Confirmation d'adresse, mot de passe, rappels | Bêta |
| 4 | **Anthropic** (clé API + limite de dépense) | Analyse réelle et évaluation (§4.3) | Bêta |
| 5 | **Nom de domaine** | HTTPS, e-mails, cookie sécurisé | Bêta |
| 6 | **Stripe** (mode test puis live, TVA) | Abonnements payants | Fin de bêta |

Variables : `.env.example` (commenté, sans valeur). Après configuration : `npm run doctor` doit tout afficher en ✔.

---

## 6. Ce qui nécessite une validation juridique

Tous les textes sont des **brouillons** (version `2026-10-06-brouillon`), avec des champs `[à compléter]`.

- CGU, politique de confidentialité, mentions légales : relecture par un juriste ; identité de l'éditeur, SIREN, contacts.
- Statut « professionnels uniquement » ou consommateurs acceptés (droit de rétractation, médiation).
- **Analyse d'impact (AIPD)** : documents financiers, fiscaux et sociaux, traitement par IA — brouillon dans `docs/04-RGPD.md`.
- **Contrats de sous-traitance (DPA)** : hébergeur, stockage, Brevo, Anthropic, Stripe ; encadrement du transfert vers les États-Unis (Anthropic).
- Responsabilité en cas d'erreur d'analyse (clause « pas de conseil »).
- Facturation et TVA (expert-comptable) ; marque « AdminIA » (recherche INPI).

---

## 7. Reste à faire avant une première bêta avec de vrais utilisateurs (dans l'ordre)

1. **Hébergement + PostgreSQL + domaine** ; clé de chiffrement générée et **sauvegardée hors de l'hébergeur** ; `npm run doctor`.
2. **Brevo** : domaine authentifié, test d'inscription réelle, mot de passe oublié, rappel.
3. **Clé Anthropic** avec limite de dépense ; **évaluation** (§4.3) sur le corpus puis sur de vrais courriers anonymisés. **Décision go / no-go sur la qualité.**
4. **Tâches planifiées** : rappels (8 h) et purge (3 h).
5. **Sauvegardes** de la base avec un **test de restauration** ; alertes sur les journaux (liste dans `docs/03-DEPLOIEMENT.md` §7).
6. Votre compte administrateur : `ADMIN_EMAILS`, puis 2FA activée.
7. **Relecture juridique minimale** des CGU et de la confidentialité, et DPA signés (§6).
8. Recette manuelle sur téléphone et ordinateur avec de vrais courriers (les vôtres d'abord).
9. Inviter 10 à 50 testeurs, **sans paiement** ; suivre activation, rétention, corrections des analyses.
10. Ensuite seulement : Stripe en mode test, puis live.

---

## 8. Reporté (décision produit, risque juridique ou coût)

| Fonctionnalité | Raison |
|---|---|
| File d'analyse asynchrone | **Écartée pour la bêta** (votre décision du 6 octobre 2026) ; à reconsidérer si le volume l'exige |
| Brouillon de réponse au courrier | Risque juridique, à cadrer |
| « Discuter avec mes documents » | Coût IA récurrent et non borné |
| Partage avec l'expert-comptable, multi-utilisateurs | Deuxième vague (TPE), décision produit |
| Transfert de courriers par e-mail | Domaine et service de réception nécessaires |
| CAPTCHA | Seulement si abus constaté (champ piège en place) |
| Connexion Google, SMS, application native | Après validation de la bêta |

---

## 9. Problèmes connus

- Qualité IA réelle non mesurée ; premier appel réel jamais effectué (§4).
- Textes juridiques en brouillon (§6).
- `npm audit` : 3 avis **modérés** sans correctif publié — `sprintf-js` (via `mammoth`, partie ligne de commande inutilisée) et `braces` (outillage de développement). Aucun avis élevé ou critique.
- `style-src 'unsafe-inline'` dans la CSP (styles en ligne des barres de progression) : risque faible.
- L'inscription révèle si une adresse est déjà inscrite (limité en fréquence) : accepté.
- Sur une page protégée, `notFound()` affiche bien la page 404 mais avec un statut HTTP 200 (rendu diffusé de Next.js) ; aucune donnée n'est envoyée.
- Détails : `docs/05-AUDIT-BETA.md`.

---

## 10. Reprendre le projet (instructions pour la prochaine session)

### 10.1 Règles impératives
- Travailler **uniquement** dans le dépôt `AdminIA`. **Ne jamais toucher au dépôt `histoireia`.**
- Branche de travail : `claude/clever-lovelace-ewb694`. Pousser avec `git push -u origin claude/clever-lovelace-ewb694`. **Pas de pull request** sans demande explicite.
- **Interdit sans accord explicite** : publier ou déployer, créer un compte, acheter ou payer, appeler l'IA réelle (coût), configurer Stripe ou un e-mail réel, toucher à Supabase, à la production ou aux données réelles.
- **Aucun secret dans Git** (un test automatique le vérifie). Ne jamais affaiblir une protection pour « faire marcher » quelque chose.
- Décision importante, compte externe ou dépense → s'arrêter et demander.
- Avant toute nouvelle étape : vérifier que PDF, analyse, validation e-mail, 2FA et administration fonctionnent (commandes ci-dessous).

### 10.2 Démarrer en développement (sans PostgreSQL, sans clé)
```bash
npm install
DATABASE_URL=pglite://./.data/pglite npm run dev      # http://localhost:3000
```
Base PGlite migrée automatiquement, IA de démonstration, e-mails écrits dans `.data/outbox/`. Un bandeau de développement permet de confirmer l'adresse sans e-mail réel. Pour l'administration en local : `ADMIN_EMAILS=vous@exemple.fr`, confirmer l'adresse, activer la 2FA dans « Mon compte ».

### 10.3 Vérifier que rien n'est cassé
```bash
npm run typecheck && npm run lint
npm test                               # 274 tests Vitest (24 fichiers), base PGlite en mémoire, ~40 s
npm run ai:eval                        # corpus IA avec le moteur de démonstration (gratuit)
npm audit --omit=dev --audit-level=high
```
Tests navigateur (build de production, PostgreSQL **local et jetable** obligatoire) :
```bash
# Une seule fois, dans un conteneur avec PostgreSQL installé :
pg_ctlcluster 16 main start
su postgres -c "psql -c \"CREATE USER adminia WITH PASSWORD '<mot de passe local au choix>'\""
su postgres -c "createdb -O adminia adminia_e2e"
# Ensuite (… = le mot de passe local choisi ci-dessus, jamais un mot de passe réel) :
E2E_DATABASE_URL=postgres://adminia:…@127.0.0.1:5432/adminia_e2e \
CHROMIUM_PATH=/opt/pw-browsers/chromium scripts/e2e-local.sh          # 14 parcours (~1 min + build)
```
Le script **refuse toute base non locale**, génère une clé jetable et utilise l'IA de démonstration. Capture de toutes les pages : ajouter `E2E_TOUR=1` et `E2E_SCREENSHOTS_DIR=…`.

Image Docker (facultatif) : `docker build -t adminia .`, puis voir `docs/03-DEPLOIEMENT.md` §1.

### 10.4 Où est quoi
| Sujet | Emplacement |
|---|---|
| Logique métier | `src/server/*` (auth, ai, documents, tasks, billing, account, admin, email, storage, security) |
| Routes API (minces) | `src/app/api/*` |
| Pages | `src/app/(site)`, `(auth)`, `(account-links)`, `app/` (espace connecté, dont `app/admin`) |
| Schéma et migrations | `src/server/db/schema.ts`, `drizzle/` (9 migrations ; nouvelles migrations : `npx drizzle-kit generate --name …`) |
| Moteur IA | `src/server/ai/` : `anthropic.ts` (réel), `mock.ts` (démonstration), `prompt.ts`, `schema.ts`, `cost.ts`, `injection.ts` |
| Évaluation IA | `evals/cases.ts`, `scripts/ai-eval.ts` |
| Configuration | `src/server/config.ts` (validée au démarrage), `.env.example` |
| Tests | `tests/` (Vitest), `e2e/` (Playwright, exécutés un par un) |

### 10.5 Prochaine action recommandée
Rien ne peut avancer utilement sans vous : commencer par le §7, étape 1 (hébergement) et étape 3 (clé Anthropic + évaluation). Sans compte externe, les seuls travaux possibles sont des améliorations hors feuille de route, à valider avec vous d'abord.

---

## 11. Documentation

| Document | Contenu |
|---|---|
| `docs/01-ETUDE-MARCHE.md` | Marché, concurrence, décisions produit, modèle économique |
| `docs/02-ARCHITECTURE.md` | Architecture, choix techniques, modèle de données, multi-instance |
| `docs/03-DEPLOIEMENT.md` | **Actions manuelles** : hébergement, Docker, S3, e-mails, IA, tâches planifiées, administration, Stripe, supervision |
| `docs/04-RGPD.md` | Registre des traitements, sous-traitants, droits, AIPD (brouillon) |
| `docs/05-AUDIT-BETA.md` | Audit de sécurité : corrigé, points ouverts, ajouts v0.3 |
| `CLAUDE.md` | Consignes courtes pour les sessions de développement assistées |

### Historique
- **v0.1** : MVP (compte, documents, analyse, échéances, recherche, RGPD).
- **v0.2** : préparation de la bêta privée (e-mails, S3, rappels, Stripe prêt, CSP, isolation de la lecture, audit).
- **v0.3** : double authentification, administration, changement d'adresse, application installable, anti-robots, CI, Docker, corpus d'évaluation élargi, tarif des modèles datés corrigé.
