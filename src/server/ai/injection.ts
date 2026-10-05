/**
 * Détection heuristique de tentatives de prompt injection dans un document.
 *
 * Ce n'est PAS la protection principale (voir prompt.ts : isolation du contenu,
 * absence d'outils, sortie contrainte). C'est un signal supplémentaire, affiché
 * à l'utilisateur, qui couvre aussi les documents frauduleux visant des IA.
 */

const PATTERNS: { reason: string; re: RegExp }[] = [
  {
    reason: "Demande d'ignorer des instructions",
    re: /\b(ignore[rsz]?|oublie[rsz]?|disregard|forget|ne tiens? pas compte)\b[^.\n]{0,60}\b(instructions?|consignes?|regles?|rules|prompts?|directives?)\b/,
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

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function detectInjection(text: string | null | undefined): string[] {
  if (!text) return [];
  const sample = normalize(text.length > 400_000 ? text.slice(0, 400_000) : text);
  const reasons: string[] = [];
  for (const { reason, re } of PATTERNS) {
    if (re.test(sample)) reasons.push(reason);
  }
  return reasons;
}
