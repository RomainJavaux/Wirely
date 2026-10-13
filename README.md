# Wirely

Éditeur de plans électriques (maison, pièce…) avec export PNG / SVG / PDF.
Vite + TypeScript, sans framework.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitaires (Vitest)
npm run typecheck
npm run build      # sortie dans dist/
```

## Architecture

Les dépendances vont toujours vers le bas : `ui` → `tools`/`render` → `core` → `domain`.

```
src/
  domain/    Modèle pur, sans DOM : types, géométrie, catalogue de symboles, validation
  core/      Store (état + historique annuler/rétablir), viewport, actions
  render/    Rendu SVG des éléments (partagé éditeur/export) et vue canevas
  tools/     Un outil par classe (sélection, pièce, mur/câble, symbole, texte)
  io/        Export (SVG/PNG/PDF), fichiers JSON, sauvegarde automatique
  ui/        Panneaux : barre du haut, palette, propriétés, raccourcis
  main.ts    Racine de composition
tests/       Tests du domaine, du store et de l'export
```

### Principes

- **Store unique** : tout l'état vit dans `Store`. `change`/`updateItem` sont transitoires
  (aperçu pendant un glisser, saisie) ; `commit` crée une étape d'historique.
- **Outils** : implémentent l'interface `Tool` ; le canevas leur transmet des `PointerInfo`
  déjà converties en coordonnées du plan. Ajouter un outil = une classe + une entrée dans
  `tools/meta.ts` et `ToolManager`.
- **Rendu partagé** : `render/items.ts` produit le même SVG pour l'éditeur et l'export.
- **Ajouter un symbole** : une ligne dans `domain/catalog.ts`.

## Format de fichier

JSON : `{ name, nextId, items: [...] }`. Les fichiers sont validés et normalisés à
l'ouverture (`parseDoc`) ; les anciens fichiers (`nid`) restent lisibles.
