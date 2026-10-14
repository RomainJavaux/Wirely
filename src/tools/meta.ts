import type { ToolId } from '../core/store';

export interface ToolMeta {
  id: ToolId;
  label: string;
  /** Raccourci clavier (minuscule). */
  key?: string;
  hint: string;
  cursor: string;
  /** Affiché dans la barre d'outils (le symbole passe par la palette). */
  inToolbar: boolean;
  /** Outil de câblage manuel : rangé sous « Câblage manuel », hors de la barre principale. */
  wiring?: boolean;
}

export const TOOLS_META: readonly ToolMeta[] = [
  { id: 'select', label: '🖱 Sélection', key: 'v', cursor: 'default', inToolbar: true,
    hint: 'Cliquez un élément pour le sélectionner, glissez pour le déplacer. Glissez le fond pour déplacer la vue.' },
  { id: 'room', label: '▭ Pièce', key: 'g', cursor: 'crosshair', inToolbar: true,
    hint: 'Glissez pour dessiner une pièce (ou utilisez « Ajouter une pièce » pour saisir ses dimensions).' },
  { id: 'wall', label: '▬ Mur', key: 'w', cursor: 'crosshair', inToolbar: true,
    hint: 'Cliquez pour poser les points du mur. Double-clic ou Entrée pour terminer.' },
  { id: 'wire', label: '〰 Câble', key: 'l', cursor: 'crosshair', inToolbar: true, wiring: true,
    hint: 'Cliquez pour tracer le câble (il s’accroche aux symboles). Double-clic ou Entrée pour terminer.' },
  { id: 'assign', label: '🔗 Affecter', key: 'a', cursor: 'crosshair', inToolbar: true, wiring: true,
    hint: 'Cliquez les câbles et appareils à raccorder au circuit actif ; re-cliquez pour les détacher.' },
  { id: 'text', label: '𝐓 Texte', key: 't', cursor: 'crosshair', inToolbar: true,
    hint: 'Cliquez où placer le texte.' },
  { id: 'symbol', label: 'Symbole', cursor: 'crosshair', inToolbar: false,
    hint: 'Cliquez près d’un mur pour poser l’appareil : il s’y accroche, orienté vers la pièce. Échap pour terminer.' },
];

export const toolMeta = (id: ToolId): ToolMeta => TOOLS_META.find((t) => t.id === id) as ToolMeta;
