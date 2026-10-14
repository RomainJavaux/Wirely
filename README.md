# Wirely

Éditeur de plans électriques (maison, pièce…) et configurateur de tableau électrique,
avec export PNG / SVG / PDF. Vite + TypeScript, sans framework.

## Deux modes

- **Plan** : pièces typées (séjour, cuisine, chambre… avec leur couleur), murs, symboles
  (prises, interrupteurs, lampes, ouvertures…) et câbles par circuit, à l'**échelle** réelle.
  Surfaces, cotes et longueurs de câble sont calculées ; un panneau de synthèse et des contrôles
  indicatifs par pièce (prises, point lumineux, détecteur de fumée) aident à la conception.
  Chaque symbole peut porter un circuit du tableau et une hauteur de pose.
  Export : fiche avec plan coté et barre d'échelle, légende chiffrée, tableau des pièces et
  nomenclature (PNG / SVG / PDF), plus CSV des pièces et de la nomenclature.
- **Tableau** : rails DIN sur lesquels on pose des appareils modulaires (disjoncteurs,
  différentiels, contacteurs…). Un différentiel protège les disjoncteurs à sa droite sur le
  rail ; l'app en déduit la structure et génère la documentation :
  face avant étiquetée, schéma unifilaire, repérage des circuits, nomenclature, CSV.
  Modules de domotique **Niko** (Nikobus et Home Control II) avec sorties nommables et règles de bus.
  Les contrôles (section/calibre, différentiel amont, réserve de 20 %…) sont **indicatifs**
  et ne remplacent ni la norme ni un professionnel.

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
    plan/    Plan : types de pièces, échelle et métriques, contrôles, exemple, exports CSV
    board/   Tableau électrique : appareils, placement sur rails, analyse, contrôles, nomenclature
  core/      Store (état + historique annuler/rétablir), viewport, actions (plan et tableau)
  render/    Rendu SVG des éléments (partagé éditeur/export) et vue canevas
    board/   Appareils réalistes, face avant, schéma unifilaire
  tools/     Un outil par classe (sélection, pièce, mur/câble, symbole, texte)
  io/        Export (SVG/PNG/PDF/CSV), fiche du tableau, fichiers JSON, sauvegarde automatique
  ui/        Panneaux : barre du haut, palette, propriétés, raccourcis
    board/   Espace de travail du tableau : palette d'appareils, glisser-déposer, réglages
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

JSON : `{ name, scale, nextId, items: [...], boards: [...] }` (`scale` : mètres par carreau). Les fichiers sont validés et normalisés à
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
