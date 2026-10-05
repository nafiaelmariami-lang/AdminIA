/**
 * Détection heuristique de tentatives de prompt injection dans un document.
 *
 * Ce n'est PAS la protection principale (voir prompt.ts : isolation du contenu,
 * absence d'outils, sortie contrainte). C'est un signal supplémentaire, affiché
 * à l'utilisateur, qui couvre aussi les documents frauduleux visant des IA.
 */

const PATTERNS: { reason: string; re: RegExp }[] = [
  {
    // Le qualificatif (« précédentes », « previous », « ci-dessus »…) est exigé : « si vous ignorez
    // les consignes de sécurité » ou « n'oubliez pas les règles » sont des phrases administratives normales.
    reason: "Demande d'ignorer des instructions",
    re: /\b(ignore[rsz]?|oublie[rsz]?|disregard|forget|ne tiens? pas compte)\b[^.\n]{0,40}(\b(previous|above|prior|earlier|all (the )?(previous|prior))\b[^.\n]{0,20}\b(instructions?|rules|prompts?|directives?)\b|\b(instructions?|consignes?|regles?|directives?)\b[^.\n]{0,20}\b(precedentes?|anterieures?|ci-dessus|du systeme)\b)/,
  },

  { reason: "Référence au prompt système", re: /\b(system ?prompt|prompt (du )?systeme|instructions? (du )?systeme|message systeme)\b/ },
  {
    reason: "Tentative de changement de rôle de l'IA",
    re: /\b(tu es (maintenant|desormais)|vous etes (maintenant|desormais)|you are now|from now on you|act as|agis comme|joue le role|pretend to be|nouveau role)\b/,
  },
  {
    reason: "Demande de secrets",
    re: /\b(revele[rsz]?|reveal|affiche[rsz]?|print|donne[rsz]?(-moi)?|give me|leak|expose[rsz]?|communique[rsz]?)\b[^.\n]{0,60}\b(secrets?|cles? (d'?)?api|api ?keys?|mots? de passe|passwords?|tokens?|variables? d'environnement|env(ironment)? var|identifiants)\b/,
  },
  { reason: "Vocabulaire de contournement d'IA", re: /\b(jailbreak|dan mode|developer mode|mode developpeur|prompt injection)\b/ },
  { reason: "Message adressé à une IA", re: /\b(note (to|for) (the )?(ai|llm|assistant)|message (a|pour) l'?(ia|intelligence artificielle)|si tu es une ia|if you are an? (ai|llm|language model))\b/ },
  { reason: "Balises de conversation ou de document imitées", re: /(<\/?\s*(system|assistant|document_utilisateur|instructions?)\b|\[\/?inst\]|<\|im_(start|end)\|>|^\s*(system|assistant)\s*:)/m },
];

/** Formes compactes (sans espaces ni ponctuation) : déjouent « i g n o r e » ou « ign-ore ». */
const COMPACT_PATTERNS: { reason: string; re: RegExp }[] = [
  {
    reason: "Demande d'ignorer des instructions",
    // Exige un qualificatif « précédentes / previous » : « oublie les règles » seul reste légitime.
    re: /(ignore|oublie|disregard|forget)(all|toutes?|les|the|your|tes|vos)*((previous|above|prior)(instructions?|rules)|(instructions?|consignes?|regles)(precedentes?|anterieures?|cidessus))/,
  },
  { reason: "Référence au prompt système", re: /(systemprompt|promptsysteme)/ },
  { reason: "Vocabulaire de contournement d'IA", re: /(jailbreak|promptinjection)/ },
];

// Caractères invisibles utilisés pour masquer des mots (zéro largeur, trait d'union conditionnel…).
const INVISIBLE = /[­​-‏⁠-⁤﻿]/g;
const COMBINING_MARKS = /[̀-ͯ]/g;

function normalize(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .normalize("NFKD") // ramène aussi les lettres « stylées » (pleine chasse, mathématiques) à l'alphabet latin
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
}

export function detectInjection(text: string | null | undefined): string[] {
  if (!text) return [];
  const sample = normalize(text.length > 400_000 ? text.slice(0, 400_000) : text);
  const reasons = new Set<string>();
  for (const { reason, re } of PATTERNS) {
    if (re.test(sample)) reasons.add(reason);
  }
  const compact = sample.replace(/[^a-z]/g, "");
  for (const { reason, re } of COMPACT_PATTERNS) {
    if (re.test(compact)) reasons.add(reason);
  }
  return [...reasons];
}
