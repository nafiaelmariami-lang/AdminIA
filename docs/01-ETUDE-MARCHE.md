# AdminIA — Étude de marché et décisions produit

> Rédigée le 5 octobre 2026. Chiffres publics à revérifier avant toute levée de fonds ou communication commerciale.

## 1. Le marché

### Taille et dynamique

- Fin 2024, l'Urssaf recense **4,8 millions de comptes de travailleurs indépendants** (+5,6 % sur un an), dont **60,4 % d'auto/micro-entrepreneurs** (+8,6 % sur un an). La croissance continue en 2025 (+7,1 % sur un an au T3 2025 pour les AE économiquement actifs).
- La population cible directe (micro-entrepreneurs, artisans, libéraux, TPE de 0 à 5 salariés) dépasse **5 millions de structures**. Même 0,1 % de pénétration payante représente ~5 000 clients, soit ~500 k€ d'ARR à 8–10 €/mois.

### Contexte réglementaire porteur

- **Facturation électronique** : réception obligatoire pour toutes les entreprises assujetties à la TVA depuis le 1er septembre 2026 ; émission obligatoire pour PME/TPE/micro au 1er septembre 2027. Les indépendants vont recevoir plus de flux numériques, et ils sont déjà sollicités par les acteurs de la facturation.
- La dématérialisation des administrations (impots.gouv, Urssaf, CAF, net-entreprises) multiplie les messages « dans votre espace » et les PDF à télécharger, sans hiérarchisation ni explication.

## 2. Les besoins réels des indépendants

Les problèmes les plus fréquents viennent des **documents entrants**, plus que de la production de factures :

1. **Comprendre** un courrier administratif : vocabulaire opaque (« mise en demeure », « majorations de retard », « régularisation », « CFE », « appel de cotisations provisionnelles »).
2. **Savoir quoi faire** : payer, répondre, contester, fournir une pièce, ou ne rien faire.
3. **Ne pas rater une échéance** : CFE (15 décembre), déclarations Urssaf mensuelles ou trimestrielles, délais de contestation (souvent 2 mois), renouvellement d'assurance, fin de devis. Une échéance ratée coûte des majorations (5 % + 0,2 %/mois Urssaf, 10 % impôts).
4. **Retrouver** un document : « où est l'attestation d'assurance décennale demandée par le client ? », « quel était le montant du devis fournisseur ? ».
5. **Le stress administratif** : c'est la première plainte des créateurs d'entreprise ; beaucoup laissent les courriers non ouverts.

## 3. Concurrence

| Acteur | Positionnement | Prix (2026) | IA documentaire | Points faibles pour notre cible |
|---|---|---|---|---|
| **Indy** | Compta + facturation autonome | Gratuit ; payant ~9–15 €/mois micro, 49 € société | Catégorisation bancaire | Centré sur la **compta sortante**, n'explique pas les courriers entrants |
| **Abby** (+ « Abby Intelligence », 2026) | Facturation + gestion micro | Freemium ; ~7–11 €/mois | Assistant IA généraliste intégré | Assistant intégré à un outil de facturation ; ce n'est pas un outil de **lecture de courrier** |
| **Pennylane** | Compta collaborative avec expert-comptable | ~14 €/mois et plus | OCR de factures | Trop complet et comptable pour un artisan ; centré justificatifs |
| **Tiime, Shine, Qonto** | Banque/compta | Gratuit à 20+ €/mois | OCR de justificatifs liés aux transactions | Le document n'est vu que comme un justificatif de dépense |
| **Dext, Klippa** | Extraction de factures pour cabinets | B2B, 20–50 €/mois | OCR/IA factures | Orientés expert-comptable, pas pédagogiques |
| **Digiposte Pro** | Coffre-fort numérique | 8,33 € HT/mois | Classement automatique basique | Stockage, aucune compréhension ni action |
| **ChatGPT / Claude / Le Chat grand public** | IA générale | 0–22 €/mois | Oui, si l'utilisateur sait formuler | Aucun **suivi** : pas d'échéancier, de rappels ni d'historique, pas de stockage organisé ; confidentialité floue pour l'utilisateur ; demande de savoir « prompter » |

**Conclusion concurrentielle** : le marché de la facturation et de la compta des indépendants est saturé et gratuit (Indy, Abby, Tiime, Shine). Pour ce cas d'usage précis, les IA généralistes ont moins de valeur que les outils spécialisés : elles analysent le document mais oublient l'échéance. **Personne ne se positionne clairement sur « je reçois un courrier, je comprends, j'agis, on me rappelle ».** C'est un créneau défendable, **complémentaire** des outils de compta (pas concurrent frontal).

## 4. Ce que nous faisons mieux

1. **Orientation action** : chaque document produit une réponse aux 5 questions « Qu'est-ce que c'est ? Que dois-je faire ? Pour quand ? Combien ? Qui me le demande ? ».
2. **Échéancier automatique** : les dates détectées deviennent des échéances suivies (à faire / fait), visibles sur le tableau de bord, exportables vers l'agenda (.ics).
3. **Pédagogie** : glossaire et langage simple, sans jargon, avec un niveau d'urgence explicite.
4. **Confiance** : données isolées et chiffrées, aucun entraînement sur les données, suppression et export en un clic. C'est aussi un argument commercial face aux IA grand public.
5. **Simplicité** : une photo ou un PDF suffit, l'utilisateur n'a rien à écrire.

## 5. Risques juridiques et RGPD

| Risque | Gravité | Mesure retenue |
|---|---|---|
| **Exercice illégal du droit** (consultation juridique réservée, loi n° 71-1130 art. 54) | Élevée | Le produit **explique et organise**, il ne donne pas de conseil juridique ou fiscal personnalisé. Mentions claires dans l'UI et les CGU (« ne remplace pas un expert-comptable ou un avocat ») ; l'IA est instruite de ne pas recommander de stratégie contentieuse. |
| **Erreur de l'IA** (mauvaise date ou mauvais montant) | Élevée | Affichage des informations extraites **avec possibilité de correction**, avertissement de vérification sur le document original, échéances modifiables, responsabilité limitée dans les CGU. |
| **Données personnelles et sensibles** (santé via CPAM/mutuelle, données financières, NIR) | Élevée | Minimisation (l'IA ne doit pas recopier les numéros de sécurité sociale ou IBAN complets), chiffrement au repos, isolation stricte, avertissement à l'upload, AIPD à réaliser avant lancement. |
| **Transfert hors UE** (API IA américaine) | Moyenne | Fournisseur IA sous clauses contractuelles types / DPF, sans entraînement sur les données API. Option à étudier avant lancement : résidence UE via un hébergeur cloud européen de modèles. À mentionner dans la politique de confidentialité. |
| **Prompt injection** via document | Moyenne | Le modèle n'a **aucun outil ni secret** dans son contexte, le document est encapsulé comme donnée non fiable, la sortie est contrainte par un schéma JSON et validée, et une détection heuristique signale les contenus suspects. Le pire cas reste confiné à l'analyse de ce document, pour cet utilisateur. |
| **Sécurité des comptes** | Élevée | Argon2id, sessions serveur révocables, cookies httpOnly, limitation des tentatives, vérification de propriété sur chaque requête. |

## 6. Coûts IA et marge

Hypothèses : un courrier moyen fait 1 à 3 pages, soit ~2 000 à 5 000 tokens en entrée (consignes + texte) et ~800 à 1 500 tokens en sortie (JSON + réflexion à effort bas).

| Modèle (prix $/M tokens entrée/sortie) | Coût par document typique | Document lourd (20 pages) |
|---|---|---|
| Claude Opus 5.5 (4 / 20) — défaut | ~0,02–0,05 $ | ~0,15–0,25 $ |
| Claude Sonnet 5.5 (2 / 10) | ~0,01–0,025 $ | ~0,08–0,12 $ |
| Claude Haiku 4.5 (1 / 5) | ~0,005–0,012 $ | ~0,04–0,06 $ |

Un utilisateur payant traite en moyenne 10 à 30 documents par mois, ce qui donne **0,30 à 1,50 $/mois de coût IA** avec le modèle par défaut. Avec un abonnement à 9,90 € TTC (8,25 € HT), la **marge brute dépasse 75–85 %** une fois l'hébergement et le stockage inclus (~0,30 €/utilisateur). Le modèle est configurable par variable d'environnement : la bascule vers un modèle moins cher est une décision business à mesurer sur un jeu de documents réels (qualité d'extraction des dates et montants).

**Risque principal** : un utilisateur abusif sur une formule illimitée. **Décision** : pas d'illimité, des quotas mensuels stricts côté serveur, des plafonds de taille et de pages, et un budget IA global quotidien avec coupe-circuit.

## 7. Décisions

### 7.1 L'idée est-elle viable ?

**Oui, sous condition de positionnement.** Un « assistant administratif IA » généraliste serait écrasé par les IA grand public et les suites de compta gratuites. **« Le décodeur de courriers administratifs avec échéancier pour indépendants »** est un positionnement clair, peu occupé, avec un coût marginal faible et une forte valeur perçue (éviter une seule majoration Urssaf rembourse un an d'abonnement).

### 7.2 Cible prioritaire

**Micro-entrepreneurs et artisans, peu à l'aise avec l'administratif** (plombiers, électriciens, coiffeurs, VTC, consultants solo, auto-entrepreneurs du BTP). Ce sont les plus nombreux, ceux qui ont le moins accès à un expert-comptable, et ceux pour qui un courrier Urssaf, impôts ou assurance est le plus anxiogène. Les professions libérales et TPE viennent en deuxième vague (multi-utilisateurs, partage avec le comptable).

### 7.3 Proposition de valeur

> **« Photographiez vos courriers. AdminIA vous dit ce que c'est, ce que vous devez faire, et vous rappelle avant l'échéance. »**

Sous-messages : « Fini les courriers Urssaf incompréhensibles », « Ne payez plus jamais de majoration de retard », « Tous vos papiers pro retrouvés en 2 secondes ».

### 7.4 MVP (indispensable)

1. Compte sécurisé (inscription, connexion, déconnexion, suppression).
2. Ajout de documents (PDF, DOCX, JPEG, PNG, WEBP, TXT), validation stricte.
3. Analyse IA structurée (type, organisme, dates, montants, références, résumé simple, actions, échéances, urgence, points importants), avec garde-fous anti-injection.
4. Classement automatique (catégories fixes : Urssaf, impôts, CAF, assurance, banque, facture, devis, contrat, fournisseur, client, autre).
5. Tableau de bord orienté action : « À faire », « Échéances proches », « Documents récents ».
6. Échéancier : à faire / fait, modifiable, export agenda (.ics).
7. Recherche plein texte (français) avec filtres par catégorie.
8. Historique d'activité.
9. RGPD : export complet (ZIP), suppression de document, suppression de compte.
10. Quotas et protection des coûts côté serveur.
11. Pages légales (brouillons à valider).

### 7.5 Reporté (après validation du MVP)

| Fonctionnalité | Raison du report |
|---|---|
| Rappels par e-mail/SMS | Nécessite un fournisseur d'envoi (achat) ; l'export agenda .ics couvre le besoin au départ |
| Paiement Stripe | Interdit sans autorisation ; architecture prête (table `subscriptions`, plans en code) |
| Brouillon de réponse au courrier | Forte valeur mais risque juridique accru, à cadrer d'abord |
| « Discuter avec mes documents » (RAG) | Coût IA récurrent et non borné, à proposer en premium |
| Transfert par e-mail (adresse dédiée) | Nécessite un domaine et un service de réception |
| Partage avec l'expert-comptable, multi-utilisateurs | Deuxième vague (TPE) |
| Application mobile native | La PWA responsive suffit pour valider |
| Connexion bancaire, compta, facturation électronique | Marché saturé, hors positionnement |
| Authentification à deux facteurs, connexion Google | V1.1 (2FA par TOTP prioritaire) |

### 7.6 Modèle économique

Options étudiées :

- **Crédits seuls** : anxiogène (« ai-je assez de crédits ? ») et prévisibilité de revenu faible. Rejeté comme modèle principal.
- **Abonnement illimité** : risque de coût non borné. Rejeté.
- **Freemium et abonnement à quotas**, avec des **packs de crédits plus tard** pour les pics (saison fiscale). **Retenu.**

| Formule | Prix | Analyses IA / mois | Stockage | Cible |
|---|---|---|---|---|
| **Découverte** | 0 € | 5 | 50 documents | Essai, acquisition |
| **Essentiel** | 7,90 € HT/mois (ou 79 €/an) | 40 | 1 000 documents | Micro-entrepreneur |
| **Pro** | 14,90 € HT/mois (ou 149 €/an) | 150 | 5 000 documents | Artisan / TPE |

Le prix reste en dessous du « seuil de douleur » de 10–15 € des outils concurrents et se justifie par une seule majoration évitée. L'objectif de marge brute de 80 % est tenu même si un utilisateur Pro consomme 100 % de son quota avec le modèle par défaut (150 × 0,05 $ ≈ 7,50 $ dans le pire cas typique, à surveiller). Si ce pire cas se confirme, on baisse le quota Pro ou on change de modèle par défaut.

### 7.7 Indicateurs à suivre dès le lancement

Activation (1er document analysé dans les 24 h), rétention à 4 semaines, conversion vers payant, coût IA par utilisateur actif, taux de correction manuelle des extractions (qualité).

## Sources

- [Bpifrance Création — croissance du nombre de travailleurs indépendants 2024](https://bpifrance-creation.fr/observatoire/bibliographie/2024-croissance-du-nombre-travailleurs-independants-reste-soutenue-portee-notamment)
- [TPE Actu — dynamique des micro-entrepreneurs (2025–2026)](https://tpeactu.fr/2026/02/24/micro-entrepreneurs-dynamique-necessite-tpe-pme/)
- [Hayot Expertise — Tiime vs Indy vs Shine 2026](https://hayot-expertise.fr/blog/tiime-vs-indy-vs-shine-compta-freelance-2026)
- [Tool-Advisor — comparatif logiciels de facturation 2026](https://tool-advisor.fr/logiciel-facturation/comparatif/)
- [Tool-Advisor — Abby vs Indy](https://tool-advisor.fr/logiciel-facturation/comparatif/abby-vs-indy/)
- [Cocowork — meilleurs outils IA comptabilité](https://cocowork.fr/meilleurs-outils-ia-comptabilite/)
- [La Poste — offre Pro Digiposte](https://www.laposte.fr/professionnel/offre-pro-digiposte)
- [Comparatif facture électronique — plateformes agréées 2026](https://www.comparatif-facture-electronique.fr/top-10-plateformes-agreees/)
- Tarifs des modèles Claude : documentation Anthropic (septembre 2026)
