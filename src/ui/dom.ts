/** Sélecteur obligatoire : lève une erreur claire si l'élément manque dans index.html. */
export function qs<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Élément introuvable : ${selector}`);
  return el;
}

/** true si le focus est dans un champ de saisie (les raccourcis clavier sont alors ignorés). */
export function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}
