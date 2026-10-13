<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            // Identifiant public court, utilisé dans l'URL de partage.
            $table->string('public_id', 16)->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->longText('data');
            // 'private' : propriétaire seul ; 'view' : consultation par toute personne ayant le lien.
            $table->string('share_mode', 8)->default('private');
            // Incrémenté à chaque enregistrement : détecte les modifications concurrentes.
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
