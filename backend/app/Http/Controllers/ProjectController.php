<?php

namespace App\Http\Controllers;

use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ProjectController extends Controller
{
    /** Taille maximale du contenu d'un projet (octets, JSON). */
    private const MAX_BYTES = 2_000_000;

    /** Nombre maximal de projets par compte. */
    private const MAX_PROJECTS = 100;

    public function index(Request $request): JsonResponse
    {
        $projects = $request->user()->projects()
            ->orderByDesc('updated_at')
            ->get()
            ->map(fn (Project $p) => $p->summary());

        return response()->json(['projects' => $projects]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->projects()->count() >= self::MAX_PROJECTS) {
            throw ValidationException::withMessages(['name' => 'Nombre maximal de schémas atteint ('.self::MAX_PROJECTS.').']);
        }

        $attrs = $this->validated($request, creating: true);
        $project = $user->projects()->create($attrs);

        return response()->json($project->load('owner')->detail($user), 201);
    }

    public function show(Request $request, Project $project): JsonResponse
    {
        $viewer = $request->user('sanctum');

        // 404 plutôt que 403 : n'indique pas l'existence d'un schéma privé.
        abort_unless($project->isViewableBy($viewer), 404);

        return response()->json($project->load('owner')->detail($viewer));
    }

    public function update(Request $request, Project $project): JsonResponse
    {
        $user = $request->user();
        abort_unless($project->isOwnedBy($user), 404);

        $request->validate(['version' => ['required', 'integer', 'min:1']]);

        if ((int) $request->input('version') !== $project->version) {
            return response()->json([
                'message' => 'Ce schéma a été modifié ailleurs depuis votre dernière synchronisation.',
                'version' => $project->version,
            ], 409);
        }

        $project->fill($this->validated($request, creating: false));
        $project->version++;
        $project->save();

        return response()->json($project->summary());
    }

    public function destroy(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->isOwnedBy($request->user()), 404);
        $project->delete();

        return response()->json(['ok' => true]);
    }

    public function share(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->isOwnedBy($request->user()), 404);

        $data = $request->validate([
            'share_mode' => ['required', 'in:'.Project::SHARE_PRIVATE.','.Project::SHARE_VIEW],
        ]);

        $project->update($data);

        return response()->json($project->summary());
    }

    public function duplicate(Request $request, Project $project): JsonResponse
    {
        $user = $request->user();
        abort_unless($project->isViewableBy($user), 404);

        if ($user->projects()->count() >= self::MAX_PROJECTS) {
            throw ValidationException::withMessages(['name' => 'Nombre maximal de schémas atteint ('.self::MAX_PROJECTS.').']);
        }

        $copy = $user->projects()->create([
            'name' => mb_substr($project->name, 0, 107).' (copie)',
            'data' => $project->data,
            'share_mode' => Project::SHARE_PRIVATE,
        ]);

        return response()->json($copy->load('owner')->detail($user), 201);
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        $data = $request->validate([
            'name' => [$required, 'string', 'min:1', 'max:120'],
            'data' => [$required, 'array'],
            // present (et non required) : un schéma vide a bien une liste d'éléments, mais vide.
            'data.items' => ['present_with:data', 'array'],
            'data.boards' => ['nullable', 'array'],
        ]);

        if (array_key_exists('data', $data)) {
            // validated() ne garde que les clés listées ci-dessus : on conserve le document entier
            // (nom, compteur d'identifiants…), que le client normalise à l'ouverture.
            $data['data'] = $request->input('data');

            if (strlen(json_encode($data['data'])) > self::MAX_BYTES) {
                throw ValidationException::withMessages(['data' => 'Ce schéma est trop volumineux.']);
            }
        }

        return $data;
    }
}
