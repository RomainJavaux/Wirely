<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_register_returns_user_and_token(): void
    {
        $response = $this->postJson('/auth/register', [
            'name' => 'Romain',
            'email' => 'romain@example.com',
            'password' => 'motdepasse-solide',
        ]);

        $response->assertCreated()
            ->assertJsonPath('user.email', 'romain@example.com')
            ->assertJsonStructure(['token']);
        $this->assertDatabaseHas('users', ['email' => 'romain@example.com']);
    }

    public function test_password_is_stored_hashed_and_never_returned(): void
    {
        $response = $this->postJson('/auth/register', [
            'name' => 'R', 'email' => 'r@example.com', 'password' => 'motdepasse-solide',
        ]);

        $this->assertStringNotContainsString('motdepasse-solide', $response->getContent());
        $this->assertNotSame('motdepasse-solide', User::first()->password);
    }

    public function test_register_rejects_weak_password_and_duplicate_email(): void
    {
        $this->postJson('/auth/register', ['name' => 'A', 'email' => 'a@example.com', 'password' => 'court'])
            ->assertUnprocessable()->assertJsonValidationErrors('password');

        User::factory()->create(['email' => 'dup@example.com']);
        $this->postJson('/auth/register', ['name' => 'B', 'email' => 'dup@example.com', 'password' => 'motdepasse-solide'])
            ->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_login_with_valid_credentials(): void
    {
        User::factory()->create(['email' => 'ok@example.com', 'password' => 'motdepasse-solide']);

        $this->postJson('/auth/login', ['email' => 'ok@example.com', 'password' => 'motdepasse-solide'])
            ->assertOk()->assertJsonStructure(['user' => ['id', 'name', 'email'], 'token']);
    }

    public function test_login_with_wrong_password_is_refused(): void
    {
        User::factory()->create(['email' => 'ok@example.com', 'password' => 'motdepasse-solide']);

        $this->postJson('/auth/login', ['email' => 'ok@example.com', 'password' => 'mauvais'])
            ->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_me_requires_a_token(): void
    {
        $this->getJson('/me')->assertUnauthorized();

        $token = $this->postJson('/auth/register', [
            'name' => 'R', 'email' => 'r@example.com', 'password' => 'motdepasse-solide',
        ])->json('token');

        $this->withToken($token)->getJson('/me')->assertOk()->assertJsonPath('user.name', 'R');
    }

    public function test_logout_revokes_the_token(): void
    {
        $token = $this->postJson('/auth/register', [
            'name' => 'R', 'email' => 'r@example.com', 'password' => 'motdepasse-solide',
        ])->json('token');

        $this->withToken($token)->postJson('/auth/logout')->assertOk();

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }
}
