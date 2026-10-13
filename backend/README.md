# API Wirely (Laravel)

API JSON des comptes et des schémas partagés. Le front est le site statique à la racine du dépôt.

- Authentification par jetons **Sanctum** (en-tête `Authorization: Bearer …`).
- Stockage **MySQL** en production (`.env`, non versionné). **SQLite** pour le développement
  local et les tests (`DB_CONNECTION=sqlite`).
- Routes sans préfixe : en production `/api/index.php` retire déjà `/api` du chemin ;
  en développement, le proxy Vite fait de même.

| Méthode | Route | Accès |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | public (limité en débit) |
| POST | `/auth/logout`, GET `/me` | connecté |
| GET | `/projects/{id}` | propriétaire, ou tout le monde si partagé par lien |
| GET, POST | `/projects` | connecté (ses propres schémas) |
| PUT, DELETE | `/projects/{id}` | propriétaire (PUT : contrôle de version) |
| PATCH | `/projects/{id}/share` | propriétaire (`private` \| `view`) |
| POST | `/projects/{id}/duplicate` | connecté, si visible |

```bash
composer install
php artisan migrate
php artisan serve --port=8000   # ou : npm run api  (à la racine)
php artisan test
```

Voir le README à la racine pour le déploiement.
