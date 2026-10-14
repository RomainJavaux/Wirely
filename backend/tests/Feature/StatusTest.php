<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class StatusTest extends TestCase
{
    use RefreshDatabase;

    public function test_status_reports_a_healthy_install(): void
    {
        $this->getJson('/status')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('checks.database', true)
            ->assertJsonPath('checks.migrated', true)
            ->assertJsonPath('hints', []);
    }

    public function test_status_points_to_missing_tables(): void
    {
        Schema::drop('projects');

        $this->getJson('/status')
            ->assertStatus(503)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('checks.database', true)
            ->assertJsonPath('checks.migrated', false);

        $this->assertStringContainsString('migrate', $this->getJson('/status')->json('hints.0'));
    }

    public function test_status_does_not_leak_secrets(): void
    {
        $body = $this->getJson('/status')->getContent();

        $this->assertStringNotContainsString((string) config('database.connections.sqlite.database'), $body);
        $this->assertStringNotContainsString((string) config('app.key'), $body);
    }
}
