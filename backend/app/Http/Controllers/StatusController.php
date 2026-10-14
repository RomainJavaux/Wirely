<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Diagnostic d'installation, à ouvrir dans le navigateur : /api/status.
 *
 * Il s'exécute dans le contexte du serveur web (version de PHP, droits d'écriture et
 * base de données peuvent différer de ceux du terminal SSH). Il ne renvoie que des
 * indicateurs : aucun mot de passe, chemin ni message d'erreur interne.
 */
class StatusController extends Controller
{
    /** Tables nécessaires au fonctionnement de l'API. */
    private const TABLES = ['users', 'projects', 'personal_access_tokens'];

    public function __invoke(): JsonResponse
    {
        $checks = [
            'php' => PHP_VERSION,
            'php_required' => $this->requiredPhp(),
            'php_ok' => PHP_VERSION_ID >= $this->requiredPhpId(),
            'app_key' => filled(config('app.key')),
            'storage_writable' => is_writable(storage_path('logs')) && is_writable(storage_path('framework')),
            'cache_ok' => $this->cacheWorks(),
            'database' => false,
            'migrated' => false,
        ];

        try {
            DB::connection()->getPdo();
            $checks['database'] = true;
            $checks['migrated'] = collect(self::TABLES)->every(fn (string $t) => Schema::hasTable($t));
        } catch (Throwable) {
            // Détail volontairement non exposé : il est dans storage/logs/laravel.log.
        }

        $hints = $this->hints($checks);
        $ok = $hints === [];

        return response()->json(['ok' => $ok, 'checks' => $checks, 'hints' => $hints], $ok ? 200 : 503);
    }

    /** Identifiant (80401 pour 8.4.1) exigé par les dépendances, lu dans le contrôle de Composer. */
    private function requiredPhpId(): int
    {
        $file = base_path('vendor/composer/platform_check.php');

        if (is_file($file) && preg_match('/PHP_VERSION_ID >= (\d+)/', (string) file_get_contents($file), $m)) {
            return (int) $m[1];
        }

        return 80300;
    }

    private function requiredPhp(): string
    {
        $id = $this->requiredPhpId();

        return sprintf('%d.%d.%d', intdiv($id, 10000), intdiv($id % 10000, 100), $id % 100);
    }

    private function cacheWorks(): bool
    {
        try {
            Cache::put('wirely-status', 1, 10);

            return Cache::get('wirely-status') === 1;
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * @param  array<string, mixed>  $c
     * @return list<string>
     */
    private function hints(array $c): array
    {
        $hints = [];

        if (! $c['php_ok']) {
            $hints[] = "Le site tourne en PHP {$c['php']} : PHP {$c['php_required']} ou plus est requis. Changez la version dans hPanel (Avancé > Configuration PHP).";
        }
        if (! $c['app_key']) {
            $hints[] = "Clé d'application absente : lancez « php artisan key:generate --force » dans backend/.";
        }
        if (! $c['storage_writable'] || ! $c['cache_ok']) {
            $hints[] = 'Dossiers non inscriptibles : lancez « chmod -R 775 storage bootstrap/cache » dans backend/.';
        }
        if (! $c['database']) {
            $hints[] = 'Connexion à la base impossible : vérifiez DB_HOST, DB_DATABASE, DB_USERNAME et DB_PASSWORD dans backend/.env, puis « php artisan config:clear ».';
        } elseif (! $c['migrated']) {
            $hints[] = 'Tables manquantes : lancez « php artisan migrate --force » dans backend/.';
        }

        return $hints;
    }
}
