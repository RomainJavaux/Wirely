<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class Project extends Model
{
    use HasFactory;

    public const SHARE_PRIVATE = 'private';
    public const SHARE_VIEW = 'view';

    protected $fillable = ['name', 'data', 'share_mode'];

    protected function casts(): array
    {
        return ['data' => 'array', 'version' => 'integer'];
    }

    protected static function booted(): void
    {
        static::creating(function (Project $project) {
            $project->public_id ??= static::newPublicId();
            // Valeurs par défaut explicites : l'instance créée n'est pas relue depuis la base.
            $project->share_mode ??= self::SHARE_PRIVATE;
            $project->version ??= 1;
        });
    }

    /** Identifiant court, aléatoire et non devinable (10 caractères base 36). */
    public static function newPublicId(): string
    {
        do {
            $id = Str::lower(Str::random(10));
        } while (static::where('public_id', $id)->exists());

        return $id;
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function isOwnedBy(?User $user): bool
    {
        return $user !== null && $user->id === $this->user_id;
    }

    public function isViewableBy(?User $user): bool
    {
        return $this->isOwnedBy($user) || $this->share_mode === self::SHARE_VIEW;
    }

    /** Résumé sans le contenu (listes). */
    public function summary(): array
    {
        return [
            'id' => $this->public_id,
            'name' => $this->name,
            'share_mode' => $this->share_mode,
            'version' => $this->version,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    /** Projet complet, vu par `$viewer`. */
    public function detail(?User $viewer): array
    {
        return $this->summary() + [
            'data' => $this->data,
            'is_owner' => $this->isOwnedBy($viewer),
            'owner_name' => $this->owner?->name,
        ];
    }
}
