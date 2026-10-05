/** Copie d'un objet sans certaines clés (pour ne jamais renvoyer de champs internes). */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}
