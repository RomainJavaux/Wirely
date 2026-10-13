# Wirely

Éditeur de plans électriques (maison, pièce…) et configurateur de tableau électrique,
avec export PNG / SVG / PDF. Vite + TypeScript, sans framework.

## Deux modes

- **Plan** : pièces, murs, symboles (prises, interrupteurs, lampes…) et câbles par circuit.
- **Tableau** : rails DIN sur lesquels on pose des appareils modulaires (disjoncteurs,
  différentiels, contacteurs…). Un différentiel protège les disjoncteurs à sa droite sur le
  rail ; l'app en déduit la structure et génère la documentation :
  face avant étiquetée, schéma unifilaire, repérage des circuits, nomenclature, CSV.
  Les contrôles (section/calibre, différentiel amont, réserve de 20 %…) sont **indicatifs**
  et ne remplacent ni la norme ni un professionnel.

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
    board/   Tableau électrique : appareils, placement sur rails, analyse, contrôles, nomenclature
  core/      Store (état + historique annuler/rétablir), viewport, actions (plan et tableau)
  render/    Rendu SVG des éléments (partagé éditeur/export) et vue canevas
    board/   Appareils réalistes, face avant, schéma unifilaire
  tools/     Un outil par classe (sélection, pièce, mur/câble, symbole, texte)
  io/        Export (SVG/PNG/PDF/CSV), fiche du tableau, fichiers JSON, sauvegarde automatique
  ui/        Panneaux : barre du haut, palette, propriétés, raccourcis
    board/   Espace de travail du tableau : palette d'appareils, glisser-déposer, réglages
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
- **Ajouter un appareil de tableau** : une entrée dans `domain/board/catalog.ts` (largeur par variante, calibres, rôle).

## Format de fichier

JSON : `{ name, nextId, items: [...], boards: [...] }`. Les fichiers sont validés et normalisés à
l'ouverture (`parseDoc`) ; les anciens fichiers (`nid`) restent lisibles.

## Déploiement (Hostinger, par git)

L'hébergeur déploie les fichiers du dépôt sans lancer de build. Le build Vite est donc
**commité dans `dist/`** et `.htaccess` sert ce dossier à la racine du site.

À chaque modification du code, avant de commiter :

```bash
npm run build      # régénère dist/
git add -A && git commit
```

Un `git push` suffit ensuite à publier.
