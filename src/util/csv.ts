const cell = (v: string): string => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV prêt pour Excel : séparateur « ; », UTF-8 avec BOM, fins de ligne CRLF. */
export function toCsv(header: string[], rows: string[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
