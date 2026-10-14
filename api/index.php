<?php

/**
 * Point d'entrée de l'API Laravel sur l'hébergement mutualisé.
 *
 * Le site est servi depuis la racine du dépôt ; Laravel vit dans backend/ (hors de portée du web)
 * et .htaccess dirige toutes les requêtes /api/... vers ce fichier.
 */

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$backend = dirname(__DIR__).'/backend';

if (! is_file($backend.'/vendor/autoload.php')) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['message' => 'API non installée : exécutez « composer install » dans backend/ (voir README).']);
    exit;
}

// Version de PHP exigée par les dépendances installées, telle que Composer l'a calculée.
// Vérifiée ici, avant Laravel : sinon Composer interrompt la requête par un texte brut peu parlant.
$required = 80300;
$platformCheck = $backend.'/vendor/composer/platform_check.php';
if (is_file($platformCheck) && preg_match('/PHP_VERSION_ID >= (\d+)/', (string) file_get_contents($platformCheck), $m)) {
    $required = (int) $m[1];
}

if (PHP_VERSION_ID < $required) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['message' => sprintf(
        'Le site tourne en PHP %s : PHP %d.%d.%d ou plus est requis. Changez la version dans hPanel (Avancé > Configuration PHP).',
        PHP_VERSION,
        intdiv($required, 10000),
        intdiv($required % 10000, 100),
        $required % 100,
    )]);
    exit;
}

if (file_exists($maintenance = $backend.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $backend.'/vendor/autoload.php';

(require_once $backend.'/bootstrap/app.php')->handleRequest(Request::capture());
