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

if (file_exists($maintenance = $backend.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $backend.'/vendor/autoload.php';

(require_once $backend.'/bootstrap/app.php')->handleRequest(Request::capture());
