import { USAGES, type DeviceDef } from '../../domain/board/catalog';
import { deviceWidth, effectiveUsage, isCircuitRole, variantOf } from '../../domain/board/layout';
import type { Device } from '../../domain/board/types';
import { esc } from '../../util/escape';

/** Largeur d'un module (17,5 mm) et hauteur d'un appareil (≈ 90 mm), en unités du plan. */
export const MOD_W = 36;
export const DEV_H = 96;
const FONT = 'Arial,sans-serif';

const label = (x: number, y: number, s: string, size: number, fill = '#111', weight = 700): string =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="${FONT}" font-weight="${weight}" text-anchor="middle" fill="${fill}">${esc(s)}</text>`;

/** Couleur d'accent d'un appareil : bleu pour les différentiels, couleur d'usage pour les circuits. */
export function deviceTone(device: Device, def: DeviceDef): string {
  if (def.tone) return def.tone;
  if (def.role === 'rcd' || def.role === 'rcbo') return '#1d6fd6';
  if (isCircuitRole(def)) return USAGES[effectiveUsage(device)].color;
  return def.role === 'feeder' ? '#374151' : '#7b8794';
}

const screws = (modules: number): string => {
  let s = '';
  for (let i = 0; i < modules; i++) {
    const cx = i * MOD_W + MOD_W / 2;
    for (const cy of [14, DEV_H - 8]) {
      s += `<circle cx="${cx}" cy="${cy}" r="2.7" fill="#c3c9d4" stroke="#7d8798" stroke-width=".8"/>`;
    }
  }
  return s;
};

const lever = (cx: number, width: number): string => {
  const w = Math.max(14, Math.min(width - 14, 26 + (width > MOD_W ? width - MOD_W - 6 : 0)));
  return (
    `<rect x="${cx - w / 2}" y="38" width="${w}" height="24" rx="3" fill="#2b303b"/>` +
    `<rect x="${cx - w / 2 + 3}" y="41" width="${w - 6}" height="9" rx="2" fill="#e5e7eb"/>`
  );
};

const testButton = (cx: number): string =>
  `<circle cx="${cx}" cy="72" r="4.5" fill="#fff" stroke="#1d6fd6" stroke-width="1.2"/>` +
  `<text x="${cx}" y="74.5" font-size="6.5" font-family="${FONT}" font-weight="700" text-anchor="middle" fill="#1d6fd6">T</text>`;

/** Module de domotique sur bus : une LED numérotée par sortie, ou un afficheur sans sortie. */
function busBody(def: DeviceDef, width: number, cx: number): string {
  let s = label(cx, 27, def.short, width > MOD_W * 2 ? 12 : 10, '#1f2430');
  if (def.ref) s += label(cx, 39, def.ref, 7.5, '#596070', 400);

  const n = def.outputs ?? 0;
  if (n > 0) {
    const perRow = (width - 12) / n >= 18 ? n : Math.ceil(n / 2);
    const cell = (width - 12) / perRow;
    for (let i = 0; i < n; i++) {
      const x = 7 + cell * ((i % perRow) + 0.5);
      const y = 55 + Math.floor(i / perRow) * 16;
      s +=
        `<circle cx="${x}" cy="${y}" r="4.6" fill="#e5e7eb" stroke="#8d96a8" stroke-width=".9"/>` +
        `<text x="${x}" y="${y + 2.3}" font-size="6" font-family="${FONT}" font-weight="700" text-anchor="middle" fill="#374151">${i + 1}</text>`;
    }
  } else {
    s +=
      `<rect x="8" y="50" width="${width - 14}" height="18" rx="2" fill="#2b303b"/>` +
      `<text x="${cx}" y="62" font-size="7.5" font-family="${FONT}" font-weight="700" text-anchor="middle" fill="#9be7a4">BUS</text>`;
  }
  const system = def.system === 'nikobus' ? 'Nikobus' : 'NHC II';
  return s + label(cx, 86, system, 7.5, '#596070', 400);
}

function auxBody(device: Device, def: DeviceDef, width: number, cx: number): string {
  if (def.system) return busBody(def, width, cx);
  switch (def.id) {
    case 'voyant':
      return `<circle cx="${cx}" cy="46" r="10" fill="#7ddc8a" stroke="#3f8f4d" stroke-width="1.4"/>` + label(cx, 84, 'HL', 8, '#596070', 400);
    case 'bornier': {
      const modules = Math.round(width / MOD_W);
      let s = `<rect x="6" y="30" width="${width - 10}" height="34" rx="2" fill="#c9a66b" stroke="#8a6d3b"/>`;
      for (let i = 0; i < modules * 2; i++) {
        const x = 8 + ((width - 12) / (modules * 2)) * (i + 0.5);
        s += `<circle cx="${x}" cy="40" r="2.4" fill="#8a6d3b"/><circle cx="${x}" cy="54" r="2.4" fill="#8a6d3b"/>`;
      }
      return s + label(cx, 84, 'N / PE', 8, '#596070', 400);
    }
    case 'prise_din':
      return (
        `<circle cx="${cx}" cy="44" r="14" fill="#fff" stroke="#6b7385" stroke-width="1.4"/>` +
        `<circle cx="${cx - 5}" cy="44" r="2" fill="#2b303b"/><circle cx="${cx + 5}" cy="44" r="2" fill="#2b303b"/>` +
        `<rect x="${cx - 1.5}" y="34" width="3" height="5" fill="#2b303b"/>` +
        label(cx, 84, `${device.rating ?? 16} A`, 8, '#596070', 400)
      );
    default: {
      let s = label(cx, 48, def.short, width > MOD_W ? 12 : 10, '#1f2430');
      if (device.rating !== null) s += label(cx, 64, `${device.rating} A`, 9, '#596070', 400);
      const v = variantOf(device).label;
      if (v && !/^\d+$/.test(v)) s += label(cx, 84, v, 8, '#596070', 400);
      return s;
    }
  }
}

/** Dessin d'un appareil dans sa case : origine en haut à gauche, largeur = modules × MOD_W. */
export function deviceGlyph(device: Device, def: DeviceDef): string {
  const modules = deviceWidth(device);
  const width = modules * MOD_W - 2;
  const cx = width / 2 + 1;

  if (def.id === 'vide') {
    return (
      `<rect x="2" y="1" width="${width - 2}" height="${DEV_H - 2}" rx="4" fill="none" stroke="#a8b0bf" stroke-dasharray="4 3"/>` +
      label(cx, 52, 'libre', 8.5, '#9aa3b2', 400)
    );
  }

  let s =
    `<rect x="1" y=".5" width="${width}" height="${DEV_H - 1}" rx="4" fill="#f5f6f8" stroke="#8d96a8"/>` +
    `<rect x="1" y=".5" width="${width}" height="7" rx="3" fill="${deviceTone(device, def)}"/>` +
    screws(modules);

  const curve = device.curve && device.rating !== null ? `${device.curve}${device.rating}` : '';
  const diff = [device.sensitivity !== null ? `${device.sensitivity}mA` : '', device.diffType ?? ''].filter(Boolean).join(' ');

  switch (def.role) {
    case 'breaker':
      s += label(cx, 31, curve, 12) + lever(cx, width) + label(cx, 84, variantOf(device).label, 8, '#596070', 400);
      break;
    case 'rcbo':
      s += label(cx, 31, curve, 12) + lever(cx, width) + testButton(cx) + label(cx, 86, diff, 7.5, '#1d6fd6');
      break;
    case 'rcd':
      s += label(cx, 31, `${device.rating ?? ''}A`, 12) + lever(cx, width) + testButton(cx) + label(cx, 86, diff, 8, '#1d6fd6');
      break;
    case 'feeder':
      s += label(cx, 31, `${device.rating ?? ''}A`, 12) + lever(cx, width) + label(cx, 84, def.short, 8, '#596070', 400);
      break;
    case 'aux':
      s += auxBody(device, def, width, cx);
      break;
  }
  return s;
}

/** Aperçu d'un appareil pour la palette (taille native). */
export function devicePreview(def: DeviceDef, device: Device): string {
  const width = deviceWidth(device) * MOD_W;
  return `<svg viewBox="0 0 ${width} ${DEV_H}" width="${Math.min(width, 100)}" height="${(Math.min(width, 100) * DEV_H) / width}" aria-hidden="true">${deviceGlyph(device, def)}</svg>`;
}
