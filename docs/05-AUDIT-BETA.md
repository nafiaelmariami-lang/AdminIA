# AdminIA — Audit avant bêta privée (v0.2.0)

> Audit réalisé le 6 octobre 2026 sur le code, les tests et l'application lancée en build de production sur PostgreSQL 16.
> C'est un audit interne : un test d'intrusion par un tiers reste recommandé avant l'ouverture au public.

## 1. Méthode

- Revue de chaque route API : authentification, contrôle de propriété, CSRF, limites de fréquence, taille des corps de requête.
- Revue des flux sensibles : authentification, jetons par e-mail, paiement, effacement, IA.
- Suite de tests automatisés : 217 tests Vitest et 6 parcours Playwright sur ordinateur et mobile, dont un contrôle de l'absence de violation CSP.
- Visite visuelle automatisée de 25 pages dans les deux formats (`E2E_TOUR=1`), captures relues une à une.
- Migration d'une base vierge de zéro, diagnostic `npm run doctor`, installation propre depuis Git.
- Recherche de secrets dans tout le dépôt (test automatisé), `npm audit`.

## 2. Problèmes trouvés et corrigés pendant cette phase

| # | Gravité | Problème | Correction |
|---|---|---|---|
| 1 | Élevée | Des comptes jetables illimités pouvaient consommer des analyses IA gratuites (abus de coûts) | Confirmation d'e-mail obligatoire avant toute analyse |
| 2 | Élevée | La suppression du compte d'un abonné laissait l'abonnement Stripe actif (prélèvements continus) | Résiliation Stripe avant l'effacement ; refus d'effacer si la résiliation échoue |
| 3 | Élevée | Un abonné pouvait ouvrir un second abonnement (double facturation) | Refus côté serveur ; changement de formule via le portail Stripe |
| 4 | Moyenne | La lecture des PDF et DOCX se faisait dans le processus principal : le délai de 20 s n'arrêtait pas réellement le travail | Lecture dans un worker isolé (mémoire plafonnée, arrêt forcé, concurrence limitée) |
| 5 | Moyenne | Un envoi « chunked » sans Content-Length était lu en entier en mémoire avant le contrôle de taille | Lecture comptée, interrompue dès la limite |
| 6 | Moyenne | CSP avec `'unsafe-inline'` pour les scripts | Nonce aléatoire par requête + `'strict-dynamic'` ; 0 violation sur tous les parcours |
| 7 | Moyenne | Délais IA cumulés (3 × 120 s) supérieurs à la durée maximale de la route (150 s) | 2 tentatives × 60 s, échéance globale de 130 s (testé) |
| 8 | Moyenne | Faux positifs du détecteur d'injection depuis la v0.1.0 (« si vous ignorez les consignes… » signalé comme suspect) | Qualificatif « précédentes / previous » exigé ; cas légitimes ajoutés aux tests |
| 9 | Moyenne | Détecteur d'injection contournable (caractères invisibles, lettres espacées, pleine chasse) | Normalisation NFKD, suppression des invisibles, forme compacte |
| 10 | Moyenne | Images de 3,8 à 5 Mo acceptées alors que l'API les refuse une fois encodées en base64 | Limite à 3,7 Mo ; réduction des photos dans le navigateur ; dimensions vérifiées |
| 11 | Moyenne | Coût des images et scans sous-estimé (1 800 jetons au lieu de ~4 800 en haute résolution) | Estimation corrigée ; scans limités à 15 pages |
| 12 | Faible | Clé héritée `__proto__` acceptée par le script des interrupteurs | `Object.hasOwn` |
| 13 | Faible | esbuild vulnérable (via drizzle-kit, outillage) | Version corrigée imposée par `overrides` |
| 14 | Faible (UX) | Bouton « Analyser » proposé à un compte non confirmé (échec garanti) ; tarifs incohérents pour un abonné ; libellés tronqués sur mobile | Corrigés et couverts par des tests navigateur |
| 15 | Faible | Moteur de démonstration : montants suivis de « € » jamais reconnus | Expression régulière corrigée |

## 3. Points ouverts

| Gravité | Point | Recommandation |
|---|---|---|
| **Élevée (métier)** | Qualité réelle de l'IA **jamais mesurée** (aucune clé API) | `npm run ai:eval -- --confirm`, puis 20 à 30 vrais courriers anonymisés, **avant** la bêta |
| **Élevée (juridique)** | CGU, confidentialité et mentions légales en brouillon ; AIPD non réalisée ; DPA non signés | Validation par un juriste (voir `docs/04-RGPD.md`) |
| ~~Moyenne~~ | ~~Pas de double authentification~~ | **Corrigé en v0.3** : TOTP facultatif + codes de secours (voir §6) |
| Moyenne | Pas de CAPTCHA : inscriptions et « mot de passe oublié » peuvent servir à envoyer des e-mails non sollicités (limités en fréquence) | Surveiller `email.*` ; ajouter un CAPTCHA respectueux de la vie privée si abus |
| Moyenne | Analyse synchrone (jusqu'à environ 2 min par requête) | Hébergeur acceptant 150 s, ou file de traitement si le volume augmente |
| Faible | L'inscription révèle si une adresse est déjà inscrite (409) | Accepté (limité en fréquence) ; à revoir si abus |
| Faible | Le verrouillage temporaire par e-mail (10 essais / 15 min) peut être déclenché par un tiers | Accepté ; ajouter IP + e-mail derrière un proxy de confiance (`TRUST_PROXY=true`) |
| Faible | Le jeton du flux agenda figure dans l'URL (journaux d'accès éventuels) | Lien révocable et régénérable ; ne pas journaliser les paramètres de requête |
| Faible | `style-src 'unsafe-inline'` (attributs de style) | Risque faible (pas de script) ; à durcir si le design le permet |
| Faible | `braces` (outillage ESLint, développement uniquement) : aucune version corrigée publiée | Mettre à jour dès qu'un correctif existe |
| Faible | `sprintf-js` (via `mammoth` → `argparse`) : avis modéré, sans version corrigée ; seule la ligne de commande de `mammoth` l'utilise, jamais l'application | Mettre à jour `mammoth` dès qu'un correctif existe |
| Faible | Pas d'intégration continue (l'interface d'administration est faite en v0.3, §7) | Pipeline CI à ajouter côté hébergement Git |

## 4. Vérifications positives

- Isolation : chaque route renvoie 404 pour une ressource d'un autre compte (testé sur toutes les routes concernées) ; recherche, export, historique et agenda sans fuite.
- Aucun secret dans le dépôt (test automatisé avec motifs vérifiés) ; `.env.example` sans valeur.
- Aucun `dangerouslySetInnerHTML`, `eval` ni `new Function` dans le code applicatif.
- Toutes les routes publiques ont une protection propre : jeton à usage unique, signature HMAC, secret `CRON_SECRET` ou signature Stripe.
- Coûts IA : estimation avant appel, plafonds par document, par utilisateur et global, quotas atomiques, coupe-circuits, journal sans contenu.
- Migrations : base vierge → 6/6, 12 tables ; `npm run doctor` vert, hors prestataires non configurés.

## 5. Verdict

**Prêt pour une bêta privée fermée (10 à 50 testeurs invités)** une fois réalisées les actions de `docs/03-DEPLOIEMENT.md` §1 à §5 : hébergement, clé de chiffrement sauvegardée, e-mails, clé IA **évaluée sur de vrais courriers**, tâches planifiées. Le paiement peut attendre la fin de la bêta. **Pas prêt pour une ouverture publique** tant que les points juridiques ne sont pas validés.

## 6. Ajout v0.3 : double authentification

- Secret TOTP (RFC 6238, SHA-1, 6 chiffres, 30 s) chiffré en base (AES-256-GCM, clé dérivée par HKDF, lié au compte) ; jamais exporté ni journalisé.
- Activation en deux temps (secret « en attente » puis code valide) ; les autres sessions sont fermées à l'activation ; e-mail de notification à l'activation et à la désactivation.
- Connexion : après le mot de passe, une étape intermédiaire de 5 minutes (jeton haché, **aucune session**), 5 essais au plus, puis limite par compte (15 / 15 min).
- Anti-rejeu : un code (ou un code plus ancien) déjà accepté est refusé, par mise à jour conditionnelle atomique (testé en concurrence).
- 10 codes de secours à usage unique, hachés, affichés une seule fois ; régénération et désactivation exigent mot de passe **et** code.
- Mot de passe oublié : pour un compte protégé, la réinitialisation n'ouvre pas de session ; la connexion redemande le code.
- Un mauvais mot de passe renvoie la même erreur qu'avant : la présence de la double authentification n'est pas révélée.

## 7. Ajout v0.3 : interface d'administration

- Accès : adresse dans `ADMIN_EMAILS` (variable d'environnement, aucune élévation possible depuis l'application) **et** adresse confirmée **et** double authentification active.
- Un non-administrateur reçoit 404 sur les routes API et la page affiche « Page introuvable » (le statut HTTP de la page peut rester 200 à cause du rendu diffusé de Next.js ; aucune donnée n'est envoyée).
- Données : agrégats et métadonnées de compte uniquement. Test automatisé : un document contenant un nom et un numéro fiscal fictifs est analysé, puis on vérifie qu'aucune réponse d'administration ne contient le nom de fichier, le texte ou un montant.
- Écritures (formule, interrupteurs) : même origine exigée (CSRF), validation stricte, journal `admin_audit` + trace dans l'historique de la personne concernée. Formule non modifiable à la main pour un abonné Stripe (409).
- Bug trouvé et corrigé par les tests pendant le développement : sous-requêtes corrélées non qualifiées (le nombre de documents par compte valait toujours 0).
