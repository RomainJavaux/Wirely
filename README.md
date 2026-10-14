# Wirely

Éditeur de plans électriques (maison, pièce…) et configurateur de tableau électrique,
avec export PNG / SVG / PDF. Vite + TypeScript, sans framework.

## À quoi ça sert

Wirely part des **pièces** et en déduit le reste : l'équipement conseillé, les circuits, le tableau,
le métré, puis le dossier à remettre. On ne dessine pas des symboles un à un : on décrit, on
ajuste, on exporte.

### Quatre usages qui guident la conception

1. **Préparer une rénovation ou une construction** (particulier, petit pro). On décrit les pièces
   (type et dimensions), « Équiper les pièces » propose prises, lumières et commandes conformes aux
   repères de la norme, on ajuste (positions et hauteurs sur chaque mur), « Générer le tableau »
   regroupe les circuits, puis le **Dossier** donne le plan, la liste des points par pièce, les
   murs cotés, les circuits et le matériel.
2. **Documenter un tableau existant** (électricien devant le tableau). Pas besoin du plan :
   **saisie rapide au clavier** (« ID 40 A type A », « 20 Lave-linge @ Cuisine »…), tableau et
   étiquettes prêts en une minute, avec les pièces desservies.
3. **Ajouter ou déplacer un point** dans une installation existante : un nouvel appareil se
   raccorde de lui-même au circuit qui dessert déjà la pièce (s'il a de la place), « Raccorder
   automatiquement » règle le reste, et chaque circuit montre ce qu'il alimente.
4. **Remettre le dossier** : un aperçu exact du document exporté (PDF, PNG, SVG, CSV), la liste des
   points à régler avant de le remettre, et un lien partageable.

### Les quatre onglets

- **Plan** — le poste de travail. Pièces (typées, à l'échelle, fusionnables en L ou en U), portes
  et fenêtres, appareillage. Un panneau **Projet** dit où on en est et propose l'étape suivante.
  Un appareil posé **s'accroche au mur** le plus proche (orienté vers la pièce, à sa hauteur
  usuelle, avec un aperçu : mur, distance au coin, hauteur). Le **tiroir des murs** (bouton
  « Murs ») montre le mur de la pièce sélectionnée de face, à l'échelle : on y glisse les appareils
  (pas de 5 cm), ou on saisit la distance au coin et la hauteur dans le panneau de droite.
  Le câblage à la main reste possible (« Câblage manuel ») mais n'est plus nécessaire.
- **Tableau** — rails DIN, appareils modulaires, Niko (Nikobus, Home Control II). Face avant
  étiquetée, unifilaire, repérage, nomenclature. Se génère depuis le plan, se saisit au clavier ou se
  construit à la souris. Onglet **Circuits** pour les gros tableaux (recherche, groupes par
  différentiel, accès au plan).
- **3D** — la maison en volume (Three.js, chargé à la demande) : murs percés, appareillage à sa
  vraie hauteur, circuit en évidence, coupe réglable.
- **Dossier** — ce que l'on remet : sections au choix, points à régler, exports.

### Ce que l'outil déduit (et ce qu'il ne fait pas)

Tous les minimums et regroupements sont des **repères indicatifs** inspirés de la NF C 15-100 ; ils
ne remplacent ni la norme ni un professionnel.

- **Équipement conseillé** par type de pièce et par surface (prises, points lumineux, commandes,
  RJ45, circuits spécialisés en cuisine, plan de travail à 110 cm, détecteur de fumée).
- **Circuits** : éclairage (≤ 8 points, jour/nuit au-delà), prises par zone (≤ 5 prises en 16 A,
  ≤ 8 en 20 A), un circuit par appareil spécialisé (plaque 32 A, lave-linge…), chauffage, chauffe-eau,
  VMC, volets. **Différentiels** : un rail type A pour les spécialisés, l'éclairage séparé des prises
  dans un grand logement, 8 circuits au plus par différentiel, 20 % de réserve.
- **Câble** : estimation par circuit (tableau → appareils, descentes depuis le plafond, marge de
  pose), regroupée par section dans le dossier. Un tracé dessiné à la main a priorité.
- Pas de calcul de puissance, de chute de tension ni de sélectivité : c'est un outil de
  documentation et de préparation, pas un logiciel de calcul.

## Lancer

```bash
npm install
cd backend && composer install && cd ..   # une fois : dépendances PHP (Laravel)
npm run api        # API Laravel sur http://127.0.0.1:8000
npm run dev        # front sur http://localhost:5173 (proxy /api -> :8000)
npm test           # tests front (Vitest)
npm run api:test   # tests API (PHPUnit)
npm run typecheck
npm run build      # sortie dans dist/
```

Sans l'API, l'éditeur fonctionne toujours en local (brouillon dans le navigateur) ;
seuls les comptes et le partage en ligne sont indisponibles.

## Comptes et partage

Chaque schéma peut être enregistré dans un compte et obtenir un lien court
`https://…/#/p/<id>` :

- **Brouillon local** (`#/`) : enregistré dans le navigateur, sans compte.
- **Enregistrer en ligne** : crée le schéma dans le compte, l'URL reçoit son id, puis chaque
  modification est enregistrée automatiquement (détection des modifications concurrentes).
- **Partager** : active la consultation par lien. Les visiteurs voient le schéma en lecture
  seule (leurs modifications ne sont pas enregistrées) et peuvent le **dupliquer** dans leur
  compte. Seul le propriétaire modifie le schéma ; un schéma privé répond 404 aux autres.

Pas de réinitialisation du mot de passe ni de vérification d'e-mail pour l'instant (cela
suppose un envoi de courriels).

## Architecture

Les dépendances vont toujours vers le bas : `ui` → `tools`/`render` → `core` → `domain`.

```
src/
  domain/    Modèle pur, sans DOM : types, géométrie, catalogue de symboles, validation
    plan/    Plan : types de pièces, échelle, besoins par pièce, équipement automatique, contrôles, exports CSV
    board/   Tableau électrique : appareils, placement sur rails, analyse, contrôles, nomenclature
    link/    Lien plan <-> tableau : circuits, appareils raccordés, circuits déduits du plan, estimation du câble
    walls/   Murs : faces d'une pièce, hauteurs de pose, accrochage, position sur un mur, contrôles
    view3d/  Modèle 3D indépendant du moteur : boîtes (murs percés, sols), plaques, câbles
  core/      Store (état + historique annuler/rétablir), viewport, actions (plan et tableau)
  render/    Rendu SVG des éléments (partagé éditeur/export) et vue canevas
    board/   Appareils réalistes, face avant, schéma unifilaire
    walls/   Élévation d'un mur (éditeur et export)
    view3d/  Vue Three.js (chargée à la demande)
  tools/     Un outil par classe (sélection, pièce, mur/câble, symbole, texte)
  io/        Export (SVG/PNG/PDF/CSV), fiche du tableau, fichiers JSON, sauvegarde automatique
  ui/        Panneaux : barre du haut, palette, propriétés, raccourcis
    board/   Espace de travail du tableau : palette d'appareils, glisser-déposer, réglages
    walls/   Tiroir des murs (sous le plan) : élévation éditable, pose rapide
    view3d/  Espace de travail 3D : coupe, circuit en évidence, détails d'un appareil
  cloud/     Client d'API, authentification, synchronisation du projet ouvert (URL #/p/<id>)
  main.ts    Racine de composition
tests/       Tests du domaine, du store, de l'export et du client d'API
api/         Point d'entrée de production de l'API (/api/* -> Laravel)
backend/     API Laravel 13 : comptes (Sanctum), projets, partage (MySQL / SQLite en local)
```

### Principes

- **Store unique** : tout l'état vit dans `Store`. `change`/`updateItem` sont transitoires
  (aperçu pendant un glisser, saisie) ; `commit` crée une étape d'historique.
- **Outils** : implémentent l'interface `Tool` ; le canevas leur transmet des `PointerInfo`
  déjà converties en coordonnées du plan. Ajouter un outil = une classe + une entrée dans
  `tools/meta.ts` et `ToolManager`.
- **Rendu partagé** : `render/items.ts` produit le même SVG pour l'éditeur et l'export.
- **Ajouter un symbole** : une ligne dans `domain/catalog.ts` (pour une porte ou une fenêtre, `gap`
  définit la coupure du mur : le symbole se pose directement sur la ligne du mur).
- **Ajouter un type de pièce** : une entrée dans `domain/plan/roomKinds.ts` (couleur, prises
  conseillées en fonction de la surface).
- **Ajouter un appareil de tableau** : une entrée dans `domain/board/catalog.ts` (largeur par variante, calibres, rôle).
- **Ajouter un module Niko (ou autre bus)** : même fichier, avec `system`, `ref`, `outputs`, `info` et
  `source` (lien vers la fiche constructeur). N'ajoutez une largeur que si elle figure dans une fiche ;
  sinon renseignez `unverified`, qui l'affiche comme « à vérifier ».

## Format de fichier

JSON : `{ name, scale, ceiling, nextId, items: [...], boards: [...] }` (`scale` : mètres par carreau ;
`ceiling` : hauteur sous plafond en cm, 250 par défaut). Un symbole porte `height` (hauteur de pose en
cm, ou `null` : la hauteur usuelle du type). Les câbles et symboles portent `breaker` (identifiant d'un appareil du tableau, ou `null`) ; un
symbole « tableau » porte `board`. Les anciens fichiers, où le circuit était un repère saisi à la
main, sont migrés à l'ouverture sur le premier tableau. Les fichiers sont validés et normalisés à
l'ouverture (`parseDoc`) ; les anciens fichiers (`nid`) restent lisibles.

## Déploiement (Hostinger, par git)

L'hébergeur déploie les fichiers du dépôt sans lancer de build. Le build Vite est donc
**commité dans `dist/`**, et `.htaccess` envoie `/api/*` vers Laravel et le reste vers `dist/`.

### À chaque modification du code

```bash
npm run build      # régénère dist/
git add -A && git commit
git push
```

### Première installation de l'API (une seule fois)

`backend/vendor/` et `backend/.env` ne sont **pas** dans git : ils se créent sur le serveur.

1. **Créer la base MySQL** dans hPanel (Bases de données → Gestion MySQL) : notez le nom de la
   base, l'utilisateur et le mot de passe (Hostinger les préfixe, par exemple `u123456789_wirely`).
2. **En SSH** (PHP 8.3 ou plus ; 8.4 convient aussi. Le réglage de hPanel est **par site**, distinct de celui du terminal), dans le dossier du site :

```bash
cd backend
composer install --no-dev --optimize-autoloader
cp .env.example .env
php artisan key:generate --force
nano .env          # renseigner DB_DATABASE, DB_USERNAME, DB_PASSWORD et APP_URL
php artisan migrate --force
```

Vérifications :

- `php artisan migrate` ne signale aucune erreur ;
- `https://<votre-domaine>/api/up` répond 200 ;
- `https://<votre-domaine>/backend/.env` répond **404**.

Ensuite, un `git push` suffit. Si une mise à jour ajoute une migration, relancez
`php artisan migrate --force` dans `backend/`. Si `backend/composer.lock` a changé (dépendances
mises à jour), relancez aussi `composer install --no-dev --optimize-autoloader` dans `backend/`.

### En cas de problème (erreur 500 à la création de compte, etc.)

Ouvrez `https://<votre-domaine>/api/status` dans le navigateur : la page teste le serveur depuis
le contexte web (version de PHP, droits d'écriture, cache, base, tables) et indique quoi corriger.
Le détail technique de l'erreur est dans `backend/storage/logs/laravel.log`.

Les dépendances sont résolues pour **PHP 8.3** (`config.platform` dans `backend/composer.json`),
ce qui garde l'application compatible avec les hébergements encore en 8.3.

## Identité visuelle

Le logo est dans `public/` (SVG, donc net à toutes les tailles) :

| Fichier | Usage |
|---|---|
| `favicon.svg` | Pictogramme seul : onglet du navigateur, avatar |
| `logo.svg` | Pictogramme + logotype, sur fond clair (en-tête de l'application) |
| `logo-white.svg` | Même logo avec logotype blanc, pour fonds sombres |
| `apple-touch-icon.png`, `icon-512.png` | Icônes d'écran d'accueil (générées depuis `favicon.svg`) |

Couleurs : bleu `#3b82f6` → `#1e40af` (fond du pictogramme), orange `#f59e0b` (le nœud du fil),
encre `#1f2430`. Le « W » du pictogramme est un fil électrique ; le point orange rappelle la
couleur des circuits d'éclairage de l'application.
