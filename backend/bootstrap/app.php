<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

/*
 * API JSON uniquement (le front est le site statique Vite).
 *
 * Aucun préfixe de route : en production le point d'entrée est /api/index.php, qui retire
 * déjà « /api » du chemin ; en développement, le proxy Vite fait de même.
 */
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        apiPrefix: '',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Pas de page de connexion côté serveur : un invité reçoit une 401, jamais une redirection.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn () => true);

        // API pure : jamais de redirection vers une page de connexion.
        $exceptions->render(fn (AuthenticationException $e, Request $request) => response()->json(
            ['message' => 'Authentification requise.'],
            401,
        ));
    })->create();
