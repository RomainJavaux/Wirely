<?php

namespace Tests\Feature;

use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProjectTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function doc(string $text = 'a'): array
    {
        return [
            'name' => 'Maison',
            'items' => [['id' => 1, 'type' => 'text', 'x' => 0, 'y' => 0, 'text' => $text]],
            'boards' => [],
            'nextId' => 2,
        ];
    }

    private function create(User $user, array $attrs = []): Project
    {
        return $user->projects()->create($attrs + ['name' => 'Maison', 'data' => $this->doc()]);
    }

    public function test_requires_authentication_to_list_and_create(): void
    {
        $this->getJson('/projects')->assertUnauthorized();
        $this->postJson('/projects', ['name' => 'x', 'data' => $this->doc()])->assertUnauthorized();
    }

    public function test_create_returns_a_short_public_id(): void
    {
        Sanctum::actingAs($user = User::factory()->create());

        $response = $this->postJson('/projects', ['name' => 'Ma maison', 'data' => $this->doc()])->assertCreated();

        $this->assertMatchesRegularExpression('/^[a-z0-9]{10}$/', $response->json('id'));
        $response->assertJsonPath('is_owner', true)->assertJsonPath('share_mode', 'private')->assertJsonPath('version', 1);
        $this->assertSame(1, $user->projects()->count());
    }

    public function test_an_empty_document_is_valid(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/projects', [
            'name' => 'Vide',
            'data' => ['name' => 'Vide', 'items' => [], 'boards' => [], 'nextId' => 1],
        ])->assertCreated();
    }

    public function test_the_whole_document_is_preserved(): void
    {
        Sanctum::actingAs(User::factory()->create());
        $doc = $this->doc() + ['custom' => ['kept' => true]];
        $doc['nextId'] = 42;

        $id = $this->postJson('/projects', ['name' => 'x', 'data' => $doc])->assertCreated()->json('id');

        $this->getJson("/projects/{$id}")
            ->assertJsonPath('data.nextId', 42)
            ->assertJsonPath('data.name', 'Maison')
            ->assertJsonPath('data.custom.kept', true);
    }

    public function test_unauthenticated_is_401_even_without_accept_header(): void
    {
        $this->call('GET', '/projects')->assertStatus(401)->assertJsonPath('message', 'Authentification requise.');
    }

    public function test_create_validates_the_document_shape(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/projects', ['name' => '', 'data' => $this->doc()])->assertUnprocessable();
        $this->postJson('/projects', ['name' => 'x', 'data' => ['name' => 'sans items']])->assertUnprocessable();
        $this->postJson('/projects', ['name' => 'x', 'data' => 'pas un objet'])->assertUnprocessable();
    }

    public function test_list_only_returns_my_projects(): void
    {
        $me = User::factory()->create();
        $this->create($me, ['name' => 'Le mien']);
        $this->create(User::factory()->create(), ['name' => 'Celui d’un autre']);

        Sanctum::actingAs($me);

        $this->getJson('/projects')->assertOk()
            ->assertJsonCount(1, 'projects')
            ->assertJsonPath('projects.0.name', 'Le mien');
    }

    public function test_private_project_is_hidden_from_others_and_anonymous(): void
    {
        $project = $this->create(User::factory()->create());

        $this->getJson("/projects/{$project->public_id}")->assertNotFound();

        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/projects/{$project->public_id}")->assertNotFound();
    }

    public function test_owner_can_read_and_update_with_version_increment(): void
    {
        $owner = User::factory()->create();
        $project = $this->create($owner);
        Sanctum::actingAs($owner);

        $this->getJson("/projects/{$project->public_id}")->assertOk()->assertJsonPath('is_owner', true);

        $this->putJson("/projects/{$project->public_id}", [
            'name' => 'Renommé', 'data' => $this->doc('b'), 'version' => 1,
        ])->assertOk()->assertJsonPath('version', 2);

        $this->assertSame('Renommé', $project->fresh()->name);
        $this->assertSame('b', $project->fresh()->data['items'][0]['text']);
    }

    public function test_stale_version_is_refused_with_conflict(): void
    {
        $owner = User::factory()->create();
        $project = $this->create($owner);
        Sanctum::actingAs($owner);

        $this->putJson("/projects/{$project->public_id}", ['data' => $this->doc('b'), 'version' => 1])->assertOk();
        $this->putJson("/projects/{$project->public_id}", ['data' => $this->doc('c'), 'version' => 1])
            ->assertStatus(409)->assertJsonPath('version', 2);

        $this->assertSame('b', $project->fresh()->data['items'][0]['text']);
    }

    public function test_cannot_modify_or_delete_someone_elses_project(): void
    {
        $project = $this->create(User::factory()->create(), ['share_mode' => 'view']);
        Sanctum::actingAs(User::factory()->create());

        $this->putJson("/projects/{$project->public_id}", ['data' => $this->doc('x'), 'version' => 1])->assertNotFound();
        $this->patchJson("/projects/{$project->public_id}/share", ['share_mode' => 'private'])->assertNotFound();
        $this->deleteJson("/projects/{$project->public_id}")->assertNotFound();

        $this->assertSame('view', $project->fresh()->share_mode);
    }

    public function test_link_shared_project_is_readable_by_anyone_but_not_owned(): void
    {
        $project = $this->create(User::factory()->create(['name' => 'Alice']), ['share_mode' => 'view']);

        $this->getJson("/projects/{$project->public_id}")
            ->assertOk()
            ->assertJsonPath('is_owner', false)
            ->assertJsonPath('owner_name', 'Alice');
    }

    public function test_owner_can_toggle_sharing(): void
    {
        $owner = User::factory()->create();
        $project = $this->create($owner);
        Sanctum::actingAs($owner);

        $this->patchJson("/projects/{$project->public_id}/share", ['share_mode' => 'view'])
            ->assertOk()->assertJsonPath('share_mode', 'view');
        $this->patchJson("/projects/{$project->public_id}/share", ['share_mode' => 'edit'])->assertUnprocessable();
    }

    public function test_duplicate_a_shared_project_into_my_account(): void
    {
        $project = $this->create(User::factory()->create(), ['share_mode' => 'view', 'name' => 'Original']);
        Sanctum::actingAs($me = User::factory()->create());

        $response = $this->postJson("/projects/{$project->public_id}/duplicate")->assertCreated();

        $response->assertJsonPath('is_owner', true)->assertJsonPath('share_mode', 'private');
        $this->assertSame('Original (copie)', $response->json('name'));
        $this->assertNotSame($project->public_id, $response->json('id'));
        $this->assertSame(1, $me->projects()->count());
    }

    public function test_cannot_duplicate_a_private_project_of_someone_else(): void
    {
        $project = $this->create(User::factory()->create());
        Sanctum::actingAs(User::factory()->create());

        $this->postJson("/projects/{$project->public_id}/duplicate")->assertNotFound();
    }

    public function test_deleting_a_project_removes_it(): void
    {
        $owner = User::factory()->create();
        $project = $this->create($owner);
        Sanctum::actingAs($owner);

        $this->deleteJson("/projects/{$project->public_id}")->assertOk();
        $this->assertDatabaseCount('projects', 0);
    }

    public function test_oversized_document_is_refused(): void
    {
        Sanctum::actingAs(User::factory()->create());
        $big = $this->doc(str_repeat('x', 2_100_000));

        $this->postJson('/projects', ['name' => 'Énorme', 'data' => $big])->assertUnprocessable();
    }
}
