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
}

export const TOOLS_META: readonly ToolMeta[] = [
  { id: 'select', label: '🖱 Sélection', key: 'v', cursor: 'default', inToolbar: true,
    hint: 'Cliquez un élément pour le sélectionner, glissez pour le déplacer. Glissez le fond pour déplacer la vue.' },
  { id: 'room', label: '▭ Pièce', key: 'g', cursor: 'crosshair', inToolbar: true,
    hint: 'Glissez pour dessiner une pièce.' },
  { id: 'wall', label: '▬ Mur', key: 'w', cursor: 'crosshair', inToolbar: true,
    hint: 'Cliquez pour poser les points du mur. Double-clic ou Entrée pour terminer.' },
  { id: 'wire', label: '〰 Câble', key: 'l', cursor: 'crosshair', inToolbar: true,
    hint: 'Cliquez pour tracer le câble (il s’accroche aux symboles). Double-clic ou Entrée pour terminer.' },
  { id: 'text', label: '𝐓 Texte', key: 't', cursor: 'crosshair', inToolbar: true,
    hint: 'Cliquez où placer le texte.' },
  { id: 'symbol', label: 'Symbole', cursor: 'crosshair', inToolbar: false,
    hint: 'Cliquez pour placer le symbole. Échap pour terminer.' },
];

export const toolMeta = (id: ToolId): ToolMeta => TOOLS_META.find((t) => t.id === id) as ToolMeta;
