# Wirely

Le carnet de chantier de l'électricien : on **compte les points** pièce par pièce, on les répartit
sur les **circuits**, et l'outil en tire le **schéma unifilaire**, le **schéma de position** et le
reste du dossier. Belgique (RGIE) ou France (NF C 15-100), au choix par chantier.
Vite + TypeScript, sans framework. La réflexion de conception est dans `docs/conception.md`.

## À quoi ça sert

Trois travaux d'électricien ont guidé la conception :

1. **Relever l'existant** (sur place, téléphone ou tablette). Devant le tableau, on note les
   différentiels et les circuits (au pouce, ou en **saisie rapide** : « ID 40 A type A »,
   « 20 Lave-linge @ Cuisine »). On active un circuit, on passe dans la pièce et on compte ce
   qu'il alimente avec de gros boutons + / −.
2. **Étudier et chiffrer** (au bureau). On liste les pièces, on compte les points voulus,
   « Raccorder » propose les circuits selon les règles du pays, et l'**estimation au point** donne
   un ordre de prix avec ses propres tarifs.
3. **Préparer le contrôle**. Les deux schémas exigés sortent des mêmes données, avec les mêmes
   repères (A1, A2… en Belgique), un cartouche (adresse, client, installateur, date) et les cases de
   signature. Une **liste de contrôle** dit ce qui manque et y conduit.

### Les principes

- **Compter d'abord, dessiner ensuite.** Un point compté est posé de lui-même sur un mur de sa
  pièce, marqué « position à vérifier ». Le plan sert à ajuster, pas à saisir.
- **Une saisie, deux schémas.** Unifilaire et schéma de position ne peuvent pas se contredire : ils
  lisent les mêmes points et les mêmes circuits.
- **Le circuit en main.** Le circuit actif (sa lettre, sa couleur) reste visible partout ; ce que
  l'on compte ou pose s'y raccorde.
- **Rien n'est ressaisi.** Adresse, client et installateur sont saisis une fois ; le pays règle le
  vocabulaire, les repères, les sections et les limites.
- **Tout s'annule**, et l'application rouvre l'espace où l'on s'était arrêté.

### Les cinq espaces

Barre latérale sur ordinateur, barre du bas sur téléphone.

- **Chantier** — pays, avancement (points, circuits, plan, dossier), prochaine étape,
  renseignements du chantier, liste de contrôle.
- **Pièces** — la liste des pièces et, pour chacune, les compteurs de points (prises simples à
  quadruples, points lumineux, commandes, appareils fixes), le circuit de chaque point. Une prise
  se change en double, triple ou quadruple sur place (ici ou dans le panneau de la sélection).
- **Tableau** — trois vues du même tableau : **Circuits** (différentiels, calibre, section, câble,
  jauge de charge), **Face avant** (rails DIN, appareils modulaires, Niko) et **Unifilaire**.
- **Plan** — les pièces à l'échelle. Déplacer une pièce emporte ses points ; la redimensionner les
  garde sur leurs murs ; un point glissé s'accroche au mur. Tiroir des **murs** (élévation, hauteur
  de pose), vue **3D** (Three.js, chargé à la demande), zoom à deux doigts sur écran tactile.
- **Dossier** — les documents à remettre : schéma unifilaire, schéma de position, repérage des
  circuits, étiquettes du tableau à l'échelle 1, liste des points, face avant, élévations des murs,
  estimation au point, matériel et câbles. Aperçu exact, impression (PDF par le navigateur), PNG,
  SVG, CSV.

### Les règles du pays (et ce que l'outil ne fait pas)

Ce sont des **repères indicatifs** ; ils ne remplacent ni le règlement, ni l'organisme de contrôle,
ni le jugement du professionnel.

- **Belgique · RGIE** — 8 points au plus par circuit qui comporte des prises (une prise multiple,
  double à quadruple, compte pour une), 2,5 mm² dès qu'il y a une prise, 1,5 mm² → 16 A et 2,5 mm² → 20 A, au moins deux
  circuits d'éclairage, différentiel général 300 mA de type A, 30 mA pour la salle de bains, le
  lave-linge, le sèche-linge et le lave-vaisselle, disjoncteurs bipolaires, circuits repérés par
  des lettres, schémas datés et signés en trois exemplaires.
- **France · NF C 15-100** — 8 socles en 1,5 mm² / 16 A, 12 en 2,5 mm² / 20 A (chaque socle compte :
  une prise double en vaut deux), 8 points lumineux par
  circuit, différentiels 30 mA (type A pour la plaque et le lave-linge), 8 circuits au plus par
  différentiel, minimums par pièce, circuits numérotés.
- **Estimation du câble** par circuit (tableau → points, descentes, marge de pose), par section.
- Pas de calcul de puissance, de chute de tension ni de sélectivité : c'est un outil de relevé, de
  préparation et de documentation, pas un logiciel de calcul.

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
    rules/   Règles par pays (RGIE, NF C 15-100) et liste de contrôle du chantier
    plan/    Pièces : types, échelle, besoins, pose automatique d'un point, déplacement avec ses points
    board/   Tableau électrique : appareils, placement sur rails, analyse, contrôles, nomenclature
    link/    Lien points <-> circuits : raccordements, circuits déduits des points, estimation du câble
    walls/   Murs : faces d'une pièce, hauteurs de pose, accrochage, position sur un mur, contrôles
    view3d/  Modèle 3D indépendant du moteur : boîtes (murs percés, sols), plaques, câbles
    points.ts, quote.ts   Points comptés et repères (A1, A2…) ; estimation au point
  core/      Store (état + historique annuler/rétablir), viewport, actions (points, circuits, plan, tableau)
  render/    Rendu SVG des éléments (partagé éditeur/export) et vue canevas
    schema/  Schéma unifilaire du chantier (un différentiel par ligne, points repérés)
    board/   Appareils réalistes, face avant
    walls/   Élévation d'un mur (éditeur et export)
    view3d/  Vue Three.js (chargée à la demande)
  tools/     Un outil par classe (sélection, pièce, mur/câble, symbole, texte)
  io/        Documents du dossier, export (SVG/PNG/PDF/CSV), fichiers JSON, sauvegarde automatique
  ui/        Navigation, en-tête, choix du circuit, propriétés, raccourcis
    home/    Chantier : avancement, renseignements, liste de contrôle
    rooms/   Pièces : compteurs de points
    board/   Tableau : circuits, face avant (palette, glisser-déposer), unifilaire
    dossier/ Documents à remettre : aperçu, impression, tarifs
    walls/   Tiroir des murs (sous le plan) : élévation éditable, pose rapide
    view3d/  Vue 3D : coupe, circuit en évidence, détails d'un appareil
  cloud/     Client d'API, authentification, synchronisation du chantier ouvert (URL #/p/<id>)
  main.ts    Racine de composition
tests/       Tests du domaine, du store, des documents et du client d'API
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
- **Ajouter ou corriger une règle** : `domain/rules/index.ts` (une fiche par pays : limites,
  sections, vocabulaire) ; les contrôles et les circuits proposés la lisent.
- **Ajouter un type de pièce** : une entrée dans `domain/plan/roomKinds.ts` (couleur, prises
  conseillées en fonction de la surface).
- **Ajouter un appareil de tableau** : une entrée dans `domain/board/catalog.ts` (largeur par variante, calibres, rôle).
- **Ajouter un module Niko (ou autre bus)** : même fichier, avec `system`, `ref`, `outputs`, `info` et
  `source` (lien vers la fiche constructeur). N'ajoutez une largeur que si elle figure dans une fiche ;
  sinon renseignez `unverified`, qui l'affiche comme « à vérifier ».

## Format de fichier

JSON : `{ name, scale, ceiling, nextId, project, items: [...], boards: [...] }` (`scale` : mètres par
carreau ; `ceiling` : hauteur sous plafond en cm, 250 par défaut ; `project` : pays, nature des
travaux, client, adresse, installateur, date, câble et pose par défaut, tarifs). Une pièce ou un point
marqué `rough` a été posé automatiquement : sa position reste à vérifier. Un symbole porte `height` (hauteur de pose en
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
