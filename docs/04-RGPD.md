# AdminIA — Registre des traitements et conformité RGPD (BROUILLON)

> **Document de travail à faire valider par un professionnel (juriste ou DPO) avant toute commercialisation.**
> Les éléments entre crochets sont à compléter. Ce registre décrit ce que fait réellement le code (v0.2).

## 1. Responsable de traitement

[Raison sociale, adresse, SIREN, contact RGPD]. Pas de DPO obligatoire a priori (à confirmer selon le volume et la nature des données traitées).

## 2. Registre des traitements

| # | Traitement | Finalité | Base légale | Données | Durée de conservation | Destinataires |
|---|---|---|---|---|---|---|
| 1 | Gestion des comptes | Fournir le service | Contrat | Nom, e-mail, mot de passe haché (Argon2id), formule, preuve de consentement (version + date) | Durée du compte ; suppression après 24 mois d'inactivité (avertissement 30 jours avant) | Hébergeur |
| 2 | Stockage et analyse des documents | Fournir le service | Contrat | Documents et texte extrait (peuvent contenir des données financières, fiscales, sociales), analyses | Jusqu'à suppression par l'utilisateur ou du compte | Hébergeur, stockage objet (fichiers chiffrés), Anthropic (analyse) |
| 3 | Échéances et rappels | Fournir le service | Contrat | Intitulés, dates, préférences de rappel | Durée du compte ; journal des rappels 400 jours | Prestataire e-mail |
| 4 | Sécurité | Prévenir les abus et la fraude | Intérêt légitime | Journal d'activité (sans contenu), compteurs de fréquence, IP si proxy de confiance | Activité 12 mois ; compteurs 2 jours | Hébergeur |
| 5 | Suivi des coûts IA | Maîtrise des coûts, facturation | Intérêt légitime | Jetons, coût, durée, identifiant de requête (aucun contenu) | 12 mois ; anonymisé à la suppression du compte | — |
| 6 | Facturation | Encaisser les abonnements | Contrat, obligation légale | Identifiant client Stripe, statut d'abonnement ; données de paiement chez Stripe uniquement | 10 ans (pièces comptables) | Stripe |

## 3. Sous-traitants (article 28)

| Sous-traitant | Rôle | Localisation | Garanties à vérifier |
|---|---|---|---|
| [Hébergeur applicatif] | Application, PostgreSQL | [UE] | DPA signé |
| [Stockage objet S3] | Fichiers **chiffrés par l'application** | [UE] | DPA ; le prestataire n'a pas la clé |
| Anthropic PBC | Analyse IA | États-Unis | DPA, clauses contractuelles types / DPF, absence d'entraînement sur les données API, durée de conservation côté API |
| [Brevo] | E-mails transactionnels | France/UE | DPA |
| Stripe | Paiement | Irlande/UE (+ transferts) | DPA Stripe |

## 4. Droits des personnes : mise en œuvre dans le produit

| Droit | Implémentation |
|---|---|
| Accès / portabilité | « Mon compte » → export ZIP (JSON + fichiers originaux) |
| Rectification | Profil, correction du titre et du classement, modification des échéances |
| Effacement | Suppression d'un document ; suppression définitive du compte (données, fichiers, sessions, résiliation de l'abonnement) |
| Opposition aux rappels | Interrupteur dans le compte + lien de désabonnement sans connexion dans chaque e-mail |
| Limitation | Sur demande au contact RGPD [procédure manuelle à définir] |

## 5. Sécurité (article 32)

Chiffrement applicatif AES-256-GCM des fichiers (clé hors base) ; HTTPS/HSTS ; Argon2id ; sessions serveur révocables ; isolation stricte par utilisateur (testée) ; CSP stricte à nonce ; lecture des documents dans un processus isolé ; validation stricte des fichiers ; limitation de fréquence ; journaux sans contenu avec masquage automatique ; sauvegardes [à configurer chez l'hébergeur, chiffrées, avec test de restauration].

## 6. Analyse d'impact (AIPD) — à réaliser

Une AIPD est **probablement requise** : traitement à grande échelle de données financières et potentiellement de données sensibles (santé via des courriers CPAM/mutuelle), avec un outil innovant (IA). Points à traiter :
- nécessité et proportionnalité (minimisation : avertissement à l'envoi, consigne de masquage à l'IA) ;
- risques : accès illégitime, modification non désirée, disparition ; erreur d'analyse conduisant à une échéance manquée ;
- mesures existantes (section 5) et résiduelles ;
- transfert hors UE (analyse IA) : évaluer l'option d'un hébergement des modèles en UE.

## 7. Cookies

Un seul cookie, strictement nécessaire (session, httpOnly, Secure, SameSite=Lax). Pas de mesure d'audience ni de publicité : pas de bandeau de consentement requis. **Toute future mesure d'audience devra être exemptée (configuration CNIL) ou soumise à consentement.**

## 8. Violations de données

Procédure à formaliser : détection (journaux), qualification, notification CNIL sous 72 h si risque, information des personnes si risque élevé, registre des violations.
