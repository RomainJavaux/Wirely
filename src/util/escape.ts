const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Échappe une valeur avant insertion dans du HTML/SVG. */
export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"]/g, (c) => MAP[c] ?? c);
