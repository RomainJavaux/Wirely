<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\StatusController;
use Illuminate\Support\Facades\Route;

// Diagnostic d'installation : https://<site>/api/status
Route::get('status', StatusController::class);

Route::prefix('auth')->group(function () {
    Route::post('register', [AuthController::class, 'register'])->middleware('throttle:6,1');
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
});

Route::get('me', [AuthController::class, 'me'])->middleware('auth:sanctum');

// Consultation : publique si le projet est partagé par lien, sinon propriétaire uniquement.
Route::get('projects/{project:public_id}', [ProjectController::class, 'show']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('projects', [ProjectController::class, 'index']);
    Route::post('projects', [ProjectController::class, 'store']);
    Route::put('projects/{project:public_id}', [ProjectController::class, 'update']);
    Route::delete('projects/{project:public_id}', [ProjectController::class, 'destroy']);
    Route::patch('projects/{project:public_id}/share', [ProjectController::class, 'share']);
    Route::post('projects/{project:public_id}/duplicate', [ProjectController::class, 'duplicate']);
});
