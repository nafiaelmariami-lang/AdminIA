# AdminIA — Architecture

## Vue d'ensemble

```
Navigateur (React, Next.js App Router)
   │  cookie de session httpOnly (aucun secret côté client)
   ▼
Next.js (Node.js) ── pages serveur (lecture) + routes API /api/* (écriture)
   │
   ├── src/server/auth        sessions, mots de passe (Argon2id), garde d'accès
   ├── src/server/documents   validation (octets magiques), extraction texte, service
   ├── src/server/ai          fournisseur IA, prompt, schéma, anti-injection, coûts
   ├── src/server/billing     formules, quotas mensuels atomiques
   ├── src/server/tasks       échéances et actions, export agenda (.ics)
   ├── src/server/account     export RGPD (ZIP), suppression de compte
   ├── src/server/storage     stockage privé chiffré (AES-256-GCM) : disque local ou S3
   ├── src/server/email       e-mails transactionnels (boîte locale / Brevo)
   ├── src/server/billing     formules, quotas, Stripe (Checkout, portail, webhooks signés)
   ├── src/server/tasks       échéances, rappels idempotents, agenda .ics
   ├── src/server/admin       administration (accès par ADMIN_EMAILS + 2FA, statistiques sans contenu, audit)
   ├── src/proxy.ts           CSP stricte à nonce par requête
   │
   ├── PostgreSQL (Drizzle ORM, migrations SQL versionnées)
   ├── Stockage objet S3 en UE (fichiers chiffrés par l'application) ou disque local
   ├── API Claude (Anthropic), Brevo, Stripe : appelés uniquement côté serveur
   └── Tâches planifiées : rappels (quotidien), purge de conservation (quotidien)
```

## Choix techniques et raisons

| Choix | Raison |
|---|---|
| **Next.js 16 + TypeScript** (un seul déploiement) | Frontend moderne et API dans un même projet typé de bout en bout : moins de pièces à maintenir pour une petite équipe. |
| **Logique métier dans `src/server/*`**, routes API minces | Testable sans serveur HTTP ; la logique ne dépend pas du framework. |
| **PostgreSQL + Drizzle** | Relationnel, transactions et `UPDATE … RETURNING` atomiques pour les quotas, recherche plein texte française native ; Drizzle est typé, sans « magie » et génère des migrations SQL lisibles. |
| **PGlite** (Postgres en WebAssembly) pour les tests et le dev local | Les tests tournent sur un vrai moteur Postgres sans installer de serveur. Ce driver est refusé en production. |
| **Sessions serveur** (jeton aléatoire de 256 bits, stocké haché SHA-256) plutôt que JWT | Révocables immédiatement (déconnexion, suppression de compte) ; une fuite de la base ne donne pas de sessions utilisables. |
| **Argon2id** | Recommandation OWASP pour le hachage des mots de passe. |
| **Chiffrement applicatif des fichiers** (AES-256-GCM, IV aléatoire, AAD = chemin) | Un accès au disque ou au bucket ne suffit pas pour lire les documents, et un fichier ne peut pas être échangé avec celui d'un autre utilisateur. |
| **Claude via le SDK officiel**, sorties structurées (schéma JSON) | Extraction fiable dans un format contraint, validée par Zod côté serveur. Modèle configurable (`AI_MODEL`). |
| **Fournisseur IA « mock »** | Tests déterministes et démonstration sans clé API ni coût. |
| **Tailwind CSS** | Interface cohérente et responsive sans dépendance à une librairie de composants. |

## Modèle de données

| Table | Rôle |
|---|---|
| `users` | Compte, formule (`plan`), champs de facturation prêts pour Stripe |
| `sessions` | Sessions serveur (id = SHA-256 du jeton) |
| `documents` | Métadonnées, statut (`uploaded`, `processing`, `analyzed`, `failed`), texte extrait, analyse IA (JSONB), colonnes dérivées (catégorie, organisme, urgence, montant), vecteur de recherche |
| `tasks` | Échéances et actions (issues de l'IA ou manuelles), statut à faire / fait |
| `usage_counters` | Consommation mensuelle d'analyses par utilisateur (incrément atomique conditionnel) |
| `rate_limits` | Fenêtres fixes de limitation de fréquence |
| `ai_calls` | Journal des appels IA : jetons, coût, durée, statut, **sans contenu** |
| `activity_log` | Historique utilisateur (connexion, ajout, analyse, suppression, export) |
| `app_settings` | Interrupteurs de fonctionnalités (coupe-circuit IA, ajouts, inscriptions) |
| `auth_tokens` | Jetons à usage unique (confirmation d'e-mail, réinitialisation), hachés |
| `reminder_log` | Rappels déjà envoyés (idempotence multi-instance) |
| `stripe_events` | Événements Stripe déjà traités (idempotence des webhooks) |
| `recovery_codes` | Codes de secours de la double authentification (hachés, usage unique) |
| `admin_audit` | Journal des actions d'administration (formule, interrupteurs), 24 mois |
| `mfa_challenges` | Étape intermédiaire de connexion (mot de passe vérifié, code attendu ; 5 min, 5 essais) |

**Isolation** : chaque requête métier filtre par `user_id` issu de la session serveur. Un document d'un autre utilisateur renvoie `404`, jamais `403`, pour ne pas révéler son existence.

## Pipeline d'analyse

1. **Ajout** : limite de fréquence, quota de stockage, taille, **type réel par octets magiques** (le type déclaré par le navigateur est ignoré), contrôle anti zip-bomb pour les DOCX, extraction du texte, chiffrement et stockage.
2. **Analyse** (`POST /api/documents/:id/analyze`) :
   1. interrupteurs (env et base), limite de fréquence ;
   2. **verrou atomique** : passage à `processing` seulement si le document est dans un état analysable, si le nombre de tentatives n'est pas dépassé et si aucune autre analyse de l'utilisateur n'est en cours ;
   3. **estimation du coût** maximal, comparée au plafond par document, au budget quotidien de l'utilisateur et au budget global quotidien ;
   4. **réservation atomique du quota** mensuel ;
   5. appel IA (délai maximal, nombre de tentatives borné, `max_tokens` borné) ;
   6. validation Zod et normalisation (dates, montants, longueurs) ;
   7. création des tâches et échéances, mise à jour de l'index de recherche ;
   8. journal `ai_calls`. En cas d'échec côté IA, le quota est rendu.

## Sécurité IA (prompt injection)

- Le prompt système est **fixe** et ne contient aucun secret ni aucune donnée d'un autre utilisateur.
- Le document est placé dans le message utilisateur, entouré de balises portant un **identifiant aléatoire** ; les balises imitées dans le document sont neutralisées.
- Le modèle n'a **aucun outil** : il ne peut ni lire d'autres données, ni appeler d'URL, ni agir.
- La sortie est **contrainte par un schéma JSON**, revalidée et bornée, puis affichée comme du texte (aucun rendu HTML ou Markdown).
- Un **détecteur heuristique** (FR/EN) et le modèle lui-même signalent les contenus suspects, et l'interface affiche un avertissement.

## Protection des coûts

Voir `src/server/ai/cost.ts` et `src/server/billing/*`. Toutes les limites sont **calculées côté serveur** à partir de la formule de l'utilisateur et de la configuration ; aucune valeur venant du client n'est prise en compte.

## Fonctionnement multi-instance

Tout l'état partagé est en base ou dans le stockage objet : sessions, limites de fréquence, quotas (incréments atomiques), verrous d'analyse (verrous consultatifs PostgreSQL), rappels (réservation `INSERT … ON CONFLICT`), webhooks (table d'idempotence). Avec `STORAGE_DRIVER=s3`, plusieurs instances peuvent tourner derrière un répartiteur de charge.

## Isolation de la lecture des documents

PDF et Word sont lus dans un `worker_thread` : mémoire plafonnée (256 Mo), arrêt forcé au bout de 20 s, au plus 4 lectures simultanées par processus. Un fichier piégé ne peut ni saturer le processus principal ni le faire tomber.

## Évolutions prévues

- **File de traitement** : si le volume l'exige, remplacer l'analyse synchrone par une file (pg-boss) sans changer le service.
- CAPTCHA à l'inscription si abus. (Faits en v0.3 : double authentification TOTP, changement d'adresse e-mail avec annulation.)
- Interface d'administration : faite en v0.3 (`/app/admin`, `src/server/admin/*`) ; les scripts `settings`, `doctor`, `purge`, `reminders` restent disponibles.
